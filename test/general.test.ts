import {applyUpdate, merge} from "src/index";

// declare jest-imported globals so we don't
// get errors from typescript
declare const test: any;
declare const expect: any;
declare const describe: any;

interface SimpleObjectState {
    one: {
        three: number;
        four: string;
        nestedObject: {
            five: string;
        };
    };
    two: {
        six: any;
    };
    seven: string;
    eight?: string;
    nine?: {
        five: string;
    };
}

function getSimpleObjectState(): SimpleObjectState {
    return {
        one: {
            three: 10,
            four: "testing!",
            nestedObject: {
                five: "five alive!",
            },
        },
        two: {
            six: 30,
        },
        seven: "seven in heaven!",
    };
}

interface ArrayState {
    scalar: number;
    array: Array<any>;
    secondArray: Array<string>;
}

function getArrayState(): ArrayState {
    return {
        scalar: 1,
        array: [
            "I'm first",
            "I'm second",
            "I'm third",
            {
                nested: "I'm in a nested object",
            },
            ["I'm in a nested array"],
        ],
        secondArray: [
            "I'm another array element",
            "I'm yet another element",
        ],
    };
}

interface DagState {
    topLevelOne: {
        object: {
            one: string;
            two: string;
        };
    };
    topLevelTwo: {
        object: {
            one: string;
            two: string;
        };
    };
    topLevelThree: {
        object: {
            three: string;
            four: string;
        };
    };
    topLevelFour: {
        object: {
            three: string;
            four: string;
        };
    };
}

function getDagState(): DagState {
    const sharedObjOne = {
        one: "I'm shared",
        two: "me too",
    };

    const sharedObjTwo = {
        three: "me three",
        four: "me four",
    };

    return {
        topLevelOne: {
            object: sharedObjOne,
        },
        topLevelTwo: {
            object: sharedObjOne,
        },
        topLevelThree: {
            object: sharedObjTwo,
        },
        topLevelFour: {
            object: sharedObjTwo,
        },
    };
}

describe("applyUpdate", () => {
    test("doesn't modify object if nothing is mutated", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            return;
        });
        // checks for *strict* equality here - i.e. the references
        // must be the same
        expect(state).toBe(newState);
    });

    test("does an immutable update when the write object is assigned to", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.one.three = 20;
            stagObj.seven = "eight is great";
            stagObj.eight = "I'm great";
        });

        // TODO(mprast): figure out a way to fire all these expectations
        // at the same time so we can give back many failures

        // the *only* references that should change are
        // the properties we actually changed, and all of
        // their ancestors. that way we can tell if an object
        // changed just by seeing if it's actually the same object.
        expect(newState).not.toBe(state);
        expect(newState.one).not.toBe(state.one);
        expect(newState.one.nestedObject).toBe(state.one.nestedObject);
        expect(newState.two).toBe(state.two);

        expect(newState.one.three).toBe(20);
        expect(newState.seven).toBe("eight is great");
        expect(newState.eight).toBe("I'm great");
    });

    test("can update across arrays using assignment", () => {
        const state = getArrayState();
        const newState = applyUpdate<ArrayState>(state, (stagObj) => {
            stagObj.array[1] = "Now *I'm* second";
            stagObj.array[3].alsoNested = "I'm also nested";
            stagObj.array[4][0] = "I've been updated";
            stagObj.array[4][2] = "there's a gap in this array";
            stagObj.array[4][3] = ["I'm a new array!"];
            stagObj.array[5] = "I'm last";
        });

        expect(newState).not.toBe(state);
        expect(newState.scalar).toBe(state.scalar);

        expect(newState.array).not.toBe(state.array);
        expect(newState.array.length).toBe(6);
        expect(newState.array[0]).toBe(state.array[0]);
        expect(newState.array[1]).toBe("Now *I'm* second");
        expect(newState.array[2]).toBe(state.array[2]);
        expect(newState.array[3]).not.toBe(state.array[3]);
        expect(newState.array[3].nested).toBe(state.array[3].nested);
        expect(newState.array[3].alsoNested).toBe("I'm also nested");
        expect(newState.array[4]).not.toBe(state.array[4]);
        expect(newState.array[4].length).toBe(4);
        expect(newState.array[4][0]).toBe("I've been updated");
        expect(newState.array[4][2]).toBe("there's a gap in this array");
        expect(newState.array[4][3]).toEqual(["I'm a new array!"]);
        expect(newState.array[5]).toBe("I'm last");

        expect(newState.secondArray).toBe(state.secondArray);
    });

    test("can update and read across arrays using methods on the prototype", () => {
        const state = getArrayState();
        const newState = applyUpdate<ArrayState>(state, (stagObj) => {
            const array = stagObj.array;
            const array2 = stagObj.secondArray;
            array.push("this is a new value");

            expect(stagObj.array[5]).toBe("this is a new value");

            array2.push(...["this is also something new", "this is a third thing"]);
            array2.fill("same", 0, 3);
            expect(array2.filter((el) => el === "same").length).toBe(3);
        });

        expect(newState.array).not.toBe(state.array);
        expect(newState.array.length).toBe(6);
        expect(newState.array[5]).toBe("this is a new value");
        expect(newState.secondArray).not.toBe(state.secondArray);
        expect(newState.secondArray).toEqual(["same", "same", "same", "this is a third thing"]);
    });

    // TODO (mprast): sketch this out and at least see if it's feasible
    // test("can handle DAGs, and not just trees", () => {

    // });

    test("can update part of the object using another part of the object", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.nine = stagObj.one.nestedObject;
        });
        expect(newState.nine).toBe(newState.one.nestedObject);
    });

    test("only updates props that are written to, not read from", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            const readVar = stagObj.one.three;
            stagObj.two.six = "updated";
        });

        expect(newState.one).toBe(state.one);
        expect(newState.two).not.toBe(state.two);
        expect(newState.two.six).toBe("updated");
    });

    test("fails if both a parent and its children are written to", () => {
        const state = getSimpleObjectState();
        expect(() => {
            applyUpdate<SimpleObjectState>(state, (stagObj) => {
                stagObj.one.nestedObject.five = "another string";
                stagObj.one.nestedObject = {
                    five: "new five",
                };
            });
        }).toThrow();
    });

    test("returns new values for written properties immediately", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.seven = "new thing";
            stagObj.eight = "another new thing";
            expect(stagObj.seven).toContain("new thing");
            expect(stagObj.eight).toContain("another new thing");
        });
    });

    test("can see new properties in Object.keys()", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.eight = "new thing";
            expect(Object.keys(stagObj)).toContain("eight");
        });
    });

    test("can handle updating already written properties after the fact", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.two.six = {
                ten: 1000,
            };
            stagObj.two.six.ten = 2000;
            stagObj.two.six.eleven = 3000;
        });
        expect(newState.two.six.ten).toBe(2000);
        expect(newState.two.six.eleven).toBe(3000);
    });

    test("can write to properties multiple times", () => {
        const state = getSimpleObjectState();
        const newState = applyUpdate<SimpleObjectState>(state, (stagObj) => {
            stagObj.two.six = 100;
            stagObj.two.six = 140;
            stagObj.two.six = {
                ten: 2000,
            };
        });
        expect(newState.two.six.ten).toBe(2000);
    });
});

describe("merge", () => {
    test("doesn't change an object on an empty merge", () => {
        const state = getSimpleObjectState();
        const newState = merge(state, {});
        expect(state).toBe(newState);
    });

    test("reassigns object hierarchy, but only changes mutated paths", () => {
        const state = getSimpleObjectState();
        const newState = merge(state, {
            one: {
                three: 20,
            },
            seven: "eight is great",
            eight: "I'm great",
        });
        expect(newState).not.toBe(state);
        expect(newState.one).not.toBe(state.one);
        expect(newState.one.nestedObject).toBe(state.one.nestedObject);
        expect(newState.two).toBe(state.two);

        expect(newState.one.three).toBe(20);
        expect(newState.seven).toBe("eight is great");
        expect(newState.eight).toBe("I'm great");
    });

    test("converts objects with _immutableStagingConvertArray set to arrays", () => {
        const state = getArrayState();
        const newState = merge(state, {
            array: {
                1: "I'm new",
                _immutableStagingConvertArray: true,
            },
        });

        expect(Array.isArray(newState.array)).toBe(true);
    });

});
