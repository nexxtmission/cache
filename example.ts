import LRUCache, { IStorage, memoize } from './index'

class InMemoryStorage implements IStorage {
    private __data: Record<string, string | undefined>;
    constructor(){
        this.__data = {};
    }
    delete(key: string): boolean {
        return delete this.__data[key];
    }
    get(key: string): string | undefined {
        return this.__data[key];
    }
    set(key: string, value: string): void {
        this.__data[key]=value;
    }
}

// (async () => {
//     const cacheStorage = new InMemoryStorage();
//     const cache = new LRUCache<string>(cacheStorage, 5);

//     await cache.set('1', 'Hello1'); // the item 1 is added and is set as top 
//     await cache.set('2', 'Hello2'); // the item 2 is added and is set as top
//     await cache.set('3', 'Hello3'); // the item 3 is added and is set as top
//     await cache.set('4', 'Hello4'); // the item 4 is added and is set as top
//     await cache.set('5', 'Hello5'); // the item 5 is added and is set as top
//     await cache.set('6', 'Hello6'); // the item 6 is added and is set as top, the item 1 is deleted
//     await cache.get('2'); // the item 2 is used and then is set as top
//     await cache.set('7', 'Hello7'); // the item 7 is added and is set as top the item 3 is deleted
//     // await cache.print();
//     const array = [];
//     for await (const [key, value] of cache){
//         array.push(key);
//     }
//     console.log(
//         array.reduce(
//             ((acc: string, current: string) => {
//                 return `${acc} > ${current}`
//             }) as any
//         )
//     )
// })()

const sleep = (time: number)=>new Promise(resolve => setTimeout(resolve, time))

const expensiveCalculation = async (arg1: number, arg2: number) => {
    await sleep(2000);
    return arg1 + arg2;
}

(async () => {    
    const cacheStorage = new InMemoryStorage();
    const cache = new LRUCache<string>(cacheStorage, 3);
    const expensiveCalculationMemoized = memoize({
        func: expensiveCalculation,
        cache,
    });

    console.log(await expensiveCalculationMemoized(1, 2)); // calling expensiveCalculation and caching the result
    console.log(await expensiveCalculationMemoized(1, 2)); // using cached result
    console.log(await expensiveCalculationMemoized(1, 3)); // calling expensiveCalculation and caching the result
    console.log(await expensiveCalculationMemoized(1, 3)); // using cached result
    console.log(await expensiveCalculationMemoized(1, 4)); // calling expensiveCalculation and caching the result
    console.log(await expensiveCalculationMemoized(1, 4)); // using cached result
    console.log(await expensiveCalculationMemoized(1, 5)); // calling expensiveCalculation and caching the result, key [1, 2] is removed from cache
    console.log(await expensiveCalculationMemoized(1, 5)); // using cached result
    console.log(await expensiveCalculationMemoized(1, 2)); // calling expensiveCalculation and caching the result again
    console.log(await expensiveCalculationMemoized(1, 2)); // using cached result
})()