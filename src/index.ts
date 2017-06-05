import union = require("lodash.union");

export function applyUpdate<T>(imObject: T, updateFunction: (stagingProxy: T) => void): T {
    const proxy = buildStagingProxy(new WeakMap<{}, {}>(), imObject);
    updateFunction(proxy);
    return resolveStagingObject(proxy, imObject);
}

// here the writeCache will store changes to objects. we want to key the changes
// on the id of the object itself. we will use this cache later when we walk
// the object graph; this will allow us to apply changes to object graphs that
// are DAGs and not just trees. Changes to nested _tracked_ objects will be stored
// under different entries in the writeCache.
function buildStagingProxy(writeCache: WeakMap<{}, {}>, object: any): any {
    return new Proxy(object, {
        // implement "in" on the proxy
        get(target, property, receiver) {
            // we should be able to retrieve the props
            // if we have the writes object
            if (property === "_immutableStagingWriteCache") {
                return writeCache;
            }

            // we need an escape hatch so that we can
            // update parts of the object using other parts of the
            // object.
            if (property === "_immutableStagingWrappedObject" ) {
                return target;
            }

            // we're making the assumption here that users will
            // never *assign* to an object via symbols
            if (typeof property === "symbol") {
                return target[property];
            }

            if(property in (writeCache.get(target) || {})) {
                return writeCache.get(target)![property];
            } else if (typeof target[property] === "object") {
                return buildStagingProxy(writeCache, target[property]);
            } else if (typeof target[property] === "function") {
                // if the function modifies its 'this' variable we want to
                // make sure to record that, so we need to bind 'this' to
                // the proxy
                return target[property].bind(receiver);
            } else {
                return target[property];
            }
        },
        set(target, property, value, receiver) {
            if (typeof target[property] === "function") {
                throw Error(`${property} is a function; you can't assign to ` +
                    `functions while updating an object using immutable-staging.`);
            }

            // Typescript doesn't recognize "includes"...?
            const protectedProperties: any = ["_immutableStagingWriteCache",
                "_immutableStagingWrappedObject",
                "_immutableStagingConvertArray"];

            if (protectedProperties.includes(property)) {
                throw Error(`'${property}' is a protected property name; ` +
                    "you shouldn't assign to it.");
            }

            // note that value might be a StagingProxy itself. that's
            // okay though, we just have to be sure to unwrap it when
            // we merge the changes back into the object graph
            if (!writeCache.has(target)) {
                writeCache.set(target, {});
            }
            writeCache.get(target)![property] = value;

            if (Array.isArray(target)) {
                maintainArrayInvariant(writeCache, target, property, value);
            }

            return true;
        },
        // we need this so that Object.keys() will work
        ownKeys(target) {
            // this is lodash union
            return union(Object.getOwnPropertyNames(target),
                         Object.keys(writeCache.get(target) || {}));
        },
        // we need this so that ownKeys will work :P
        getOwnPropertyDescriptor(target, prop) {
            // make sure we only return prop descriptors for properties that
            // actually belong to this object.
            if (prop in (writeCache.get(target) || {})) {
                return Object.getOwnPropertyDescriptor(writeCache.get(target), prop);
            } else {
                return Object.getOwnPropertyDescriptor(object, prop);
            }
        },
        // we need this so the "(prop in object)" construct will work
        has(target, prop) {
            return (prop in target || prop in (writeCache.get(target) || {}) ||
                prop === "_immutableStagingWrappedObject");
        },
    });
}

// unfortunately we have to emulate some aspects of the javascript
// engine when it comes to things like the "length" property. in
// particular, length always should be greater than or equal to n,
// where n is 1 + the greatest integral property of the Array.
// as such, setting length to less than n should remove properties
// from the array until the invariant is true again.
function maintainArrayInvariant(writeCache: any,
                                target: Array<any>,
                                property: PropertyKey,
                                value: any) {
    // this is definitely a hack, but we need an extra bit to
    // indicate what's an array and what's not, since there's
    // no way to assign an object to an array and have the result
    // be an array. we'll use this in the merge function to
    // coerce mutated arrays back into arrays. a nice property of
    // this approach is that it allows us to assign objects to
    // properties that currently hold arrays without things breaking
    // down.
    writeCache.get(target)[`_immutableStagingConvertArray`] = true;

    const index = parseInt((property as string), 10);
    const currentLen = "length" in writeCache.get(target) ?
                            writeCache.get(target).length : target.length;
    if (!Number.isNaN(index)) {
        const newLen = index + 1;
        if (newLen > currentLen) {
            writeCache.get(target).length = newLen;
        }
    } else if (property === "length") {
        const newLen = value;
        if (newLen < currentLen) {
            for(let i = newLen; i < currentLen; i++) {
                delete writeCache.get(target)[i];
            }
        }
    } else {
        throw Error(`A property (${property}) that's not an integer or 'length' ` +
            `was set on an array (items ${target.slice(0,5)}...).`);
    }
}

function resolveStagingObject<T>(stagingProxy: T, object: T) {
    const writeCache = (stagingProxy as any)._immutableStagingWriteCache;

    return applyWrites(object, writeCache, new WeakMap<{}, {}>());
}

// exported for testing.
// we basically walk the object graph and apply patches wherever
// we can. we do a shallow copy of an object whenever there's a
// patch to apply. object and writeCache are the same as they
// are above. "applied" holds references from original objects
// in the graph to their copies that have changes applied.
export function applyWrites(object: any, writeCache: WeakMap<{}, {}>, applied: WeakMap<{}, {}>) {
    const objectPatch = writeCache.get(object) || {};
    let retObj;

    // make sure we look at both the object and its patch when trying to recurse.
    // the invariant is - whenever an object (or its patch) has a reference to
    // another object, the patch should end up containing a reference to that
    // object with all relevant changes applied!
    const patched = Object.assign({}, object, objectPatch);
    Object.getOwnPropertyNames(patched).forEach((property: string) => {
        if (typeof patched[property] === "object") {
            let nestedObj = patched[property];
            if ("_immutableStagingWrappedObject" in nestedObj) {
                // unwrap the object before recursing if we stored it
                // as a staging proxy. writes to it will already be
                // stored in writeCache so we don't need to do anything
                // special to get those.
                nestedObj = nestedObj._immutableStagingWrappedObject;
            }

            if (!(applied.has(nestedObj))) {
                applyWrites(nestedObj, writeCache, applied);
            }

            if (patched[property] !== applied.get(nestedObj)) {
                objectPatch[property] = applied.get(nestedObj);
            }
        }
    });

    if (Object.keys(objectPatch).length === 0) {
        retObj = object;
    } else {
        retObj = Object.assign({}, object, objectPatch);
    }

    if (retObj._immutableStagingConvertArray) {
        delete retObj._immutableStagingConvertArray;
        retObj = Array.from(retObj);
    }

    applied.set(object, retObj);
    return retObj;
}

