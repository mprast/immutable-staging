import set = require("lodash.set");
import merge = require("lodash.merge");
export function applyUpdate<T>(imObject: T, updateFunction: (stagingProxy: T) => void): T {
    const proxy = buildStagingProxy({}, "", imObject);
    updateFunction(proxy);
    return resolveStagingObject(proxy, imObject);
}

function buildStagingProxy(writeCache: any, prefix: string, object: any): any {
    return new Proxy(object, {
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

            // if the function modifies its 'this' variable we want to
            // make sure to record that, so we need to bind 'this' to
            // the proxy
            if (typeof target[property] === "function") {
                return target[property].bind(receiver);
            }

            const qualifiedProp = `${prefix}.${property}`;
            if(qualifiedProp in writeCache) {
                return writeCache[qualifiedProp];
            } else {
                return buildStagingProxy(writeCache, qualifiedProp, target[property]);
            }
        },
        set(target, property, value, receiver) {
            const qualifiedProp = `${prefix}.${property}`;
            if (typeof target[property] === "function") {
                throw Error(`${qualifiedProp} is a function; you can't assign to ` +
                    `functions while updating an object using immutable-staging.`);
            }

            if (property === "_immutableStagingWriteCache") {
                throw Error("'_immutableStagingWriteCache' is a protected property name; " +
                    "you shouldn't assign to it.");
            }

            if (property === "_immutableStagingWrappedObject") {
                throw Error("'_immutableStagingWrappedObject' is a protected property name; " +
                    "you shouldn't assign to it.");
            }

            // sometimes we want to update parts of the object
            // using other parts of the object. in those cases we
            // need to be sure to remove the proxy.
            if ("_immutableStagingWrappedObject" in value) {
                writeCache[qualifiedProp] = value._immutableStagingWrappedObject;
                return true;
            }

            writeCache[qualifiedProp] = value;
            return true;
        },
    });
}

function resolveStagingObject<T>(stagingProxy: T, object: T): T {
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
    const propNames = Object.keys(stagingProxy).sort();
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
    // this also comes from lodash
    return merge(object, objectChanges);
}
