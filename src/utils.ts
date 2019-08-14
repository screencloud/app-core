
export type Arrayfied<T> = {
    [P in keyof T]: Array<T[P]>;
};

export function arrayfy<T>(obj: T): Arrayfied<T> {
    return Object
        .keys(obj)
        .reduce((prev: any, key: string) => {
            prev[key] = [(obj as any)[key]];
            return prev;
        }, {}) as Arrayfied<T>;
}
