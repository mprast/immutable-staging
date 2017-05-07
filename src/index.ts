import set = require("lodash.set");
import union = require("lodash.union");

export function applyUpdate<T>(imObject: T, updateFunction: (stagingProxy: T) => void): T {
    const proxy = buildStagingProxy({}, imObject, "");
    updateFunction(proxy);
    return resolveStagingObject(proxy, imObject);
}

function buildStagingProxy(writeCache: any, object: any, prefix: string): any {
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
            // never assign to an object via symbols
            if (typeof property === "symbol") {
                return target[property];
            }

            const qualifiedProp = `${prefix}${property}`;

            if(qualifiedProp in writeCache) {
                return writeCache[qualifiedProp];
            } else if (typeof target[property] === "object") {
                return buildStagingProxy(writeCache, target[property], qualifiedProp + ".");
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
            const qualifiedProp = `${prefix}${property}`;

            if (typeof target[property] === "function") {
                throw Error(`${qualifiedProp} is a function; you can't assign to ` +
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

            if (Array.isArray(target)) {
                maintainArrayInvariant(writeCache, target, property, prefix, value);
            }

            // sometimes we want to update parts of the object
            // using other parts of the object. in those cases we
            // need to be sure to remove the proxy.
            if (typeof value === "object" && "_immutableStagingWrappedObject" in value) {
                writeCache[qualifiedProp] = value._immutableStagingWrappedObject;
                return true;
            }

            writeCache[qualifiedProp] = value;
            return true;
        },
        // we need this so that Object.keys() will work
        ownKeys(target) {
            const keyStartsWith = (key: string) => {
                return key.length > prefix.length && key.startsWith(prefix);
            };
            const qWrittenKeys = Object.keys(writeCache).filter(keyStartsWith);
            const writtenKeys = qWrittenKeys.map((key: string) => key.slice(prefix.length));
            // this is lodash union
            return union(Object.getOwnPropertyNames(target), writtenKeys);
        },
        // we need this so that ownKeys will work :P
        getOwnPropertyDescriptor(target, prop) {
            // make sure we only return prop descriptors for properties that
            // actually belong to this object.
            if (`${prefix}${prop}` in writeCache && (prop as string).indexOf(".") === -1) {
                return Object.getOwnPropertyDescriptor(writeCache, `${prefix}${prop}`);
            } else {
                return Object.getOwnPropertyDescriptor(object, prop);
            }
        },
        // we need this so the "(prop in object)" construct will work
        has(target, prop) {
            return (prop in target || `${prefix}${prop}` in writeCache);
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
                                prefix: string,
                                value: any) {
    // this is definitely a hack, but we need an extra bit to
    // indicate what's an array and what's not, since there's
    // no way to assign an object to an array and have the result
    // be an array. we'll use this in the merge function to
    // coerce mutated arrays back into arrays. a nice property of
    // this approach is that it allows us to assign objects to
    // properties that currently hold arrays without things breaking
    // down.
    writeCache[`${prefix}_immutableStagingConvertArray`] = true;

    const qLength = `${prefix}length`;
    const index = parseInt((property as string), 10);
    const currentLen = qLength in writeCache ? writeCache[qLength] : target.length;
    if (!Number.isNaN(index)) {
        const newLen = index + 1;
        if (newLen > currentLen) {
            writeCache[qLength] = newLen;
        }
    } else if (property === "length") {
        const newLen = value;
        if (newLen < currentLen) {
            for(let i = newLen; i < currentLen; i++) {
                delete writeCache[`${prefix}${i}`];
            }
        }
    } else {
        throw Error(`A property (${property}) that's not an integer or 'length' ` +
                    `was set on an array (${prefix}${property}).`);
    }
}

function resolveStagingObject<T>(stagingProxy: T, object: T) {
    const writtenProps = (stagingProxy as any)._immutableStagingWriteCache;
    // order alphabetically. that way if one string is
    // a prefix of another, it'll be right before it, and
    // we can catch that case without doing multiple
    // passes.
    //
    // we want to throw when one string is a prefix of
    // another, since it doesn't make sense to replace
    // both a node and its children, and is probably not
    // what the user intended (it might break the code
    // too!)
    const propNames = Object.keys(writtenProps).sort();
    // fudging it a little here; assuming no prop string
    // can start with a space
    let prevName = " ";
    const objectChanges = {};
    propNames.forEach((name) => {
        if(name.startsWith(prevName)) {
            throw Error(`Property ${prevName} was assigned to, but (at least) its ` +
                `child ${name} was assigned to beforehand. This can cause incorrect ` +
                `behavior. If you want to write to both the parent and the child, please ` +
                `write to the parent first.`);
        }
        prevName = name;

        // set function comes from lodash - mutates the object
        // since we don't want to clone it for every property.
        set(objectChanges, name, writtenProps[name]);
    });

    return merge(object, objectChanges);
}

// exported for testing
export function merge(objectOne: any, objectTwo: any) {
    if (Object.keys(objectTwo).length === 0) {
        return objectOne;
    }

    const merged = Object.assign({}, objectOne);
    Object.getOwnPropertyNames(objectTwo).forEach((mergeProp: string) => {
        if (typeof objectOne[mergeProp] === "object" &&
            typeof objectTwo[mergeProp] === "object") {
            merged[mergeProp] = merge(objectOne[mergeProp], objectTwo[mergeProp]);

            if (merged[mergeProp]._immutableStagingConvertArray) {
                delete merged[mergeProp]._immutableStagingConvertArray;
                merged[mergeProp] = Array.from(merged[mergeProp]);
            }
        } else {
            merged[mergeProp] = objectTwo[mergeProp];
        }
    });

    return merged;
}
