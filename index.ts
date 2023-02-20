import md5 from 'crypto-js/md5';

export interface IStorage {
    get(key: string): string | undefined | Promise<string | undefined>;
    delete(key: string): boolean | Promise<boolean>;
    set(key: string, value: string): this | void | Promise<void>;
}

interface INode<V> {
    next?: string;
    prev?: string;
    value: V;
    key: string;
}

export const generateKey = (str: string) => String(md5(str));

interface ICache<T> {
    get(key: string): string | undefined | Promise<string | undefined>;
    set(key: string, value: T): this | void | Promise<void>;
}

interface Logger {
    cacheUsed?: (...value: unknown[]) => void;
    funcCalled?: (...value: unknown[]) => void;
    error?: (error: Error, ...value: unknown[]) => void;
}

interface Memoize<T> {
    func: (...value: unknown[]) => T;
    keyResolver?: (...value: unknown[]) => string;
    cache: ICache<T>;
    logger?: Logger;
}

export function memoize<T>({
    func,
    keyResolver,
    cache,
    logger,
}: Memoize<T>) {
    const { cacheUsed = () => {}, funcCalled = () => {}, error: logError = () => {} } = logger || {};
    if (
        typeof func != 'function' ||
        (keyResolver != null && typeof keyResolver != 'function')
    ) {
        throw new TypeError('Expected a function');
    }
    if ((cache != null && (typeof cache.get != 'function' || typeof cache.set != 'function'))) {
        throw new TypeError('Expected cache');
    }
    if(!logger || typeof cacheUsed != 'function' || typeof funcCalled != 'function' || typeof logError != 'function'){
        throw new TypeError('Expected logger.cacheUsed, logger.funcCalled and logger.error must be functions');
    }
    const memoized = async function (...args: unknown[]) {
        let functionResult;
        try {
            const key = keyResolver ? keyResolver(...args) : generateKey(JSON.stringify(args));
            const valueFromCache = await cache.get(key);
            if (valueFromCache) {
                cacheUsed(...args);
                return valueFromCache;
            }
            funcCalled(...args);
            functionResult = await func(...args);
            await cache.set(key, functionResult);
        } catch (error) {
            logError(error as Error, ...args);
        }
        if (functionResult) {
            return functionResult;
        }
        funcCalled(...args)
        return func(...args);
    };
    return memoized;
}

export class LRUCache<V> {
    private __headKeyPointer = 'lru-cache-head-key-pointer';
    private __tailKeyPointer = 'lru-cache-tail-key-pointer';
    private __charsSizeKey = 'lru-cache-characters-size';
    private __sizeKey = 'lru-cache-size';

    constructor(private storage: IStorage = new Map(), readonly capacity: number = 100, readonly charsCapacity?: number) { }
    private async _getNode(key: string): Promise<INode<V> | undefined> {
        const serializedNode = await this.storage.get(key);
        if (serializedNode) {
            return JSON.parse(serializedNode) as INode<V>;
        }
        return undefined;
    }
    private async _setNode(key: string, node: INode<V>): Promise<void> {
        await this.storage.set(key, JSON.stringify(node));
    }
    private async _getTail(): Promise<INode<V> | undefined> {
        const tailKey = await this.storage.get(this.__tailKeyPointer);
        if (tailKey) {
            return this._getNode(tailKey);
        }
        return undefined;
    }
    private async _setTail(newTailNode: INode<V>): Promise<void> {
        const currentTailNode = await this._getTail();
        if (currentTailNode && currentTailNode.key !== newTailNode.key) {
            currentTailNode.prev = newTailNode.key;
            await this._setNode(currentTailNode.key, currentTailNode);
            newTailNode.next = currentTailNode?.key;
            newTailNode.prev = undefined;
            await this._setNode(newTailNode.key, newTailNode);
            await this.storage.set(this.__tailKeyPointer, newTailNode.key);
        }
    }
    private async _getHead(): Promise<INode<V> | undefined> {
        const headKey = await this.storage.get(this.__headKeyPointer);
        if (headKey) {
            return this._getNode(headKey);
        }
        return undefined;
    }
    private _getMetadataEstimatedCharsSize() {
        return this.__sizeKey.length+this.__charsSizeKey.length+this.__headKeyPointer.length+this.__tailKeyPointer.length + 200;
    }
    private async _initialize(newNode: INode<V>) {
        await this.storage.set(this.__tailKeyPointer, newNode.key);
        await this.storage.set(this.__headKeyPointer, newNode.key);
        await this.storage.set(this.__charsSizeKey, String(this._getMetadataEstimatedCharsSize()))
        await this._setNode(newNode.key, newNode);
        return;
    }
    private async _removeHead() {
        const currentHead = await this._getHead();
        if (currentHead && currentHead.prev) {
            const newHead = await this._getNode(currentHead.prev);
            if (newHead) {
                await this._setNode(newHead?.key, {
                    ...newHead,
                    next: undefined,
                });
                await this.storage.set(this.__headKeyPointer, newHead.key);
            }
        }
        currentHead?.key && await this.storage.delete(currentHead.key);
        return currentHead;
    }

    private async _getSize(): Promise<number> {
        return Number(this.storage.get(this.__sizeKey)) || 0;
    }
    private async _getCharsSize(): Promise<number> {
        return Number(this.storage.get(this.__charsSizeKey)) || 0;
    }
    private async _increaseSize(): Promise<number> {
        const currentSize = await this._getSize();
        const newSize = currentSize + 1;
        await this.storage.set(this.__sizeKey, JSON.stringify(newSize));
        return newSize;
    }
    private async _decreaseSize(itemsRemoved: number=1): Promise<number> {
        const currentSize = await this._getSize();
        const newSize = (currentSize - itemsRemoved) || 0;
        await this.storage.set(this.__sizeKey, JSON.stringify(newSize));
        return newSize;
    }
    private async _increaseCharsSize(charsAdded: number): Promise<number> {
        const currentSize = await this._getCharsSize();
        const newSize = currentSize + charsAdded;
        await this.storage.set(this.__charsSizeKey, JSON.stringify(newSize));
        return newSize;
    }
    private async _decreaseCharsSize(charsRemoved: number): Promise<number> {
        const currentSize = await this._getCharsSize();
        const newSize = (currentSize - charsRemoved) || 0;
        await this.storage.set(this.__charsSizeKey, JSON.stringify(newSize));
        return newSize;
    }
    private async __setAsTop(node: INode<V>): Promise<void> {
        const previousNode = node.prev ? await this._getNode(node.prev) : undefined;
        const nextNode = node.next ? await this._getNode(node.next) : undefined;
        if (previousNode) {
            previousNode.next = node.next;
            await this._setNode(previousNode.key, previousNode);
        }
        if (nextNode) {
            nextNode.prev = node.prev;
            await this._setNode(nextNode.key, nextNode);
        }
        if (!nextNode && previousNode) {
            await this.storage.set(this.__headKeyPointer, previousNode.key);
        }

        await this._setTail(node);
    }
    async get(key: string): Promise<V | undefined> {
        const node = await this._getNode(key);
        if (node) {
            const tailKey = await this.storage.get(this.__tailKeyPointer);
            if (node.key !== tailKey) {
                await this.__setAsTop(node);
            }
            return node.value;
        }
        return undefined;
    }
    private async _checkCapacity(newNode: INode<V>) {
        if(this.charsCapacity !== undefined && this.charsCapacity > 0){
            const currentCharsSize = await this._getCharsSize();
            const estimatedNewNodeSize = this._getNewNodeEstimatedSize(newNode.key, newNode.value)
            let removedItems = 0;
            let removedChars = 0;
            while(currentCharsSize+estimatedNewNodeSize-removedChars>this.charsCapacity){
                const removedItem = await this._removeHead();
                removedItems+=1;
                removedChars+=(removedItem ? this._getNodeCharsSize(removedItem) : 0);
            }
            await this._decreaseSize(removedItems);
            await this._decreaseCharsSize(removedChars);
        }
        const length = await this._getSize();
        if (length + 1 > this.capacity) {
            await this._removeHead();
            await this._decreaseSize();
        }
    }
    private _getNodeCharsSize(node: INode<V>): number {
        return JSON.stringify(node).length + node.key.length;
    }
    private _getNewNodeEstimatedSize(key: string, value: V) {
        return this._getNodeCharsSize({
            key,
            value,
            next: key,
            prev: key
        });
    }
    private async _addNewNode(key: string, value: V) {
        const newNode = {
            value,
            key,
        };
        const isFirstElement = !(await this._getSize());
        if (isFirstElement) {
            await this._initialize(newNode);
            await this._increaseSize();
            await this._increaseCharsSize(this._getNewNodeEstimatedSize(key, value));
            return;
        }
        await this._checkCapacity(newNode);
        await this._setTail(newNode);
        await this._increaseSize();
        await this._increaseCharsSize(this._getNewNodeEstimatedSize(key, value));
    }
    async set(key: string, value: V): Promise<void> {
        const currentNode = await this._getNode(key);
        if (currentNode !== undefined) {
            await this._setNode(key, {
                ...currentNode,
                value,
            });
            await this.get(key);
            return;
        }
        await this._addNewNode(key, value);
    }
    async *entries() {
        let currentNode = await this._getTail();
        yield [currentNode?.key, currentNode?.value];
        while (currentNode?.next) {
            currentNode = await this._getNode(currentNode.next);
            yield [currentNode?.key, currentNode?.value];
        }
    }
    async *reverseEntries() {
        let currentNode = await this._getHead();
        yield [currentNode?.key, currentNode?.value];
        while (currentNode?.prev) {
            currentNode = await this._getNode(currentNode.prev);
            yield [currentNode?.key, currentNode?.value];
        }
    }
    [Symbol.asyncIterator]() {
        return this.entries();
    }
    async print(reverse = false) {
        console.log('tail', '-->', await this.storage.get(this.__tailKeyPointer));
        console.log('head', '-->', await this.storage.get(this.__headKeyPointer));
        for await (const [key, value] of reverse ? this.reverseEntries() : this.entries()) {
            console.log(key, '-->', value);
        }
    }
}
