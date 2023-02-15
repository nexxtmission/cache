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

export function memoize({
    func,
    keyResolver,
    cache
}: any) {
    if (
        typeof func != 'function' ||
        (keyResolver != null && typeof keyResolver != 'function')
    ) {
        throw new TypeError('Expected a function');
    }
    if ((cache != null && (typeof cache.get != 'function' || typeof cache.set != 'function'))) {
        throw new TypeError('Expected cache');

    }
    const memoized: any = async function (...args: any[]) {
        const key = keyResolver ? keyResolver(...args) : JSON.stringify(args);
        const valueFromCache = await cache.get(key);
        if (valueFromCache) {
            return valueFromCache;
        }
        var result = await func(...args);
        await cache.set(key, result);
        return result;
    };
    return memoized;
}

export class LRUCache<V> {
    private __headKeyPointer = 'lru-cache-head-key-pointer';
    private __tailKeyPointer = 'lru-cache-tail-key-pointer';
    private __sizeKey = 'lru-cache-size';

    constructor(private storage: IStorage = new Map(), readonly capacity: number = 100) { }
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
    private async _initialize(newNode: INode<V>) {
        await this.storage.set(this.__tailKeyPointer, newNode.key);
        await this.storage.set(this.__headKeyPointer, newNode.key);
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
    }

    public async _getSize(): Promise<number> {
        return Number(this.storage.get(this.__sizeKey)) || 0;
    }
    private async _increaseSize(): Promise<number> {
        const currentSize = await this._getSize();
        const newSize = currentSize + 1;
        await this.storage.set(this.__sizeKey, JSON.stringify(newSize));
        return newSize;
    }
    private async _decreaseSize(): Promise<number> {
        const currentSize = await this._getSize();
        const newSize = (currentSize - 1) || 0;
        await this.storage.set(this.__sizeKey, JSON.stringify(newSize));
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
        const newNode = {
            value,
            key,
        };
        const isFirstElement = !(await this._getSize());
        if (isFirstElement) {
            await this._initialize(newNode);
            await this._increaseSize();
            return;
        }
        await this._setTail(newNode);
        const storageSize = await this._getSize();
        if (storageSize + 1 > this.capacity) {
            await this._removeHead();
            return;
        }
        await this._increaseSize();
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