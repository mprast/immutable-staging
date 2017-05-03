import set = require("lodash.set");
export function applyUpdate<T>(imObject: T, updateFunction: (readObj: T, writeObj: T) => void): T {
    const [readObj, writeObj] = buildStagingObjects(imObject);
    updateFunction(readObj, writeObj);
    return resolveStagingObject(writeObj, imObject);
}

function buildStagingObjects<T>(object: T): Array<T>{
    // we'll close over this. it'll be shared storage between the read 
    // object and the write object
    const writtenProps:any = {}
    
    const reads = new Proxy(object, {
        get: function(target, property, receiver){
            if(property in writtenProps){
                return writtenProps[property];
            }

            // Typescript should ensure that this property 
            // actually exists
            return target[property];
        }
    });

    const writes:any = new Proxy(object, {
        get: function(target, property, receiver){
            if(!(property in writtenProps)){
                // Typescript should ensure that the property 
                // actually exists

                // not that this is a shallow clone
                writtenProps[property] = Object.assign({}, target[property]);
            }

            return writtenProps[property];
        },
        set: function(target, property, value, receiver){
            writtenProps[property] = property;
            return true;
        }
    });

    writes._writtenProps = writtenProps;

    return [reads, writes as T];
}

function resolveStagingObject<T>(writes: T, object: T): T{
    const writtenProps = (writes as any)._writtenProps;
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
    const propNames = Object.keys(writes).sort();
    // fudging it a little here; assuming no prop string 
    // can start with a space
    let prevName = " ";
    let objectChanges = {};
    propNames.forEach(function(name){
        if(name.startsWith(prevName)){
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
    return Object.assign(object, objectChanges);
}


