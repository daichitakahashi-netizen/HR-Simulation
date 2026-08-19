declare module 'munkres-js' {
  function compute(costMatrix: number[][], options?: Record<string, any>): Array<[number, number]>;

  class Munkres {
    compute(costMatrix: number[][], options?: Record<string, any>): Array<[number, number]>;
  }

  export = compute;
}
