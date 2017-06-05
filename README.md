# immutable-staging
Library for updating immutable objects by mutating "staging objects". Good for mutating deep state trees.

# Motivation
Immutable objects are valuable for a number of reasons, but it's often awkward to work with them, especially if they 
are deeply nested. immutable-staging uses ES6 proxies to intercept writes to an object tree and apply them in an "immutable" style.
The api will construct a staging object and pass it to a callback, and you can make your writes on the staging 
object in a "mutable" style. Intuitively, this means that given:

```javascript
const object = {key1: "I'm a key", key2: 5, nested: {nested1: "I'm nested!"}};
```

you can write code like:

```javascript
object.key1 = "I'm changed!";
object.key3 = "I'm new!";
object.nested.nested2 = "I'm nested and new!";
```

but what will basically happen behind the scenes is:

```javascript
let newNested = Object.assign({nested2: "I'm nested and new!"}, object.nested);
let newObject = Object.assign({key1: "I'm changed!", key3: "I'm new!", nested: newNested}, object);
```
and the overall result of the method call will be `newObject`. More formally - the object tree returned by this api (OR)
relates to the object tree passed into it (OI) like so: for any object in the tree, OR === OI if and only if OR == OI 
and all object properties of OR === the corresponding properties of OI. In other words, any updates to an object in OI 
mean that that object _and all of its parents_ are replaced by new objects in OR. This property is particularly useful 
because it allows you to use reference equality when doing things like calculating deltas (as Redux does) - if your 
object reference is the same as the last time you checked, then you know that your object hasn't changed and you don't 
need to put anything in the delta.

The hope is that this provides a natural and concise way to specify the changes you'd like to make to an immutable object.

# The API
There's only one method:
```function applyUpdate<T>(imObject: T, updateFunction: (stagingProxy: T) => void): T```
* `imObject`: The object you want to apply changes to. *This object will never be mutated*
* `updateFunction`: A callback that takes a "staging proxy" and writes to it. The staging proxy behaves exactly like `imObject`,
but all writes to the proxy will be intercepted and applied after the fact (your writes can still be read within the 
callback - see the features section). 

Here's an examplebased on the Motivation section:
```javascript
import {applyUpdate} from "immutable-staging";

const object = {key1: "I'm a key", key2: 5, nested: {nested1: "I'm nested!"}};

const newObject = applyUpdate(object, (staging) => {
  staging.key1 = "I'm changed!";
  staging.key3 = "I'm new!";
  staging.nested.nested2 = "I'm nested and new!";
});
```

Notice that you don't need to return anything in the callback itself.

# Features
*All the semantics of normal Javascript objects are preserved*. You can treat the staging object exactly as if it were a 
normal object and it will behave like you expect. As mentioned above this means you can "read your writes" like so

```javascript
const object = {key1: "I'm a key", key2: 5, nested: {nested1: "I'm nested!"}};

const newObject = applyUpdate(object, (staging) => {
  staging.key1 = "You can read me";
  alert(staging.key1); // will be "You can read me"
});
```
It also means you can use arrays freely. You can even keep using familliar methods on the Array prototype

```javascript
const object = {key1: "I'm a key", array: [5], nested: {nested1: "I'm nested!"}};

const newObject = applyUpdate(object, (staging) => {
  staging.array[1] = 10;
  staging.array.push(20);
  staging.array.push(30);
  staging.array.fill(40, 1, 3);
  alert(staging.array); // will be [5, 40, 40, 30]
  staging.array.filter((n) => n % 2 === 1) // will return [5]
});
```

To reemphasize, `object` itself is never modified, although the staging proxy makes it appear like it is.

`immutable-staging` will work with any object structure, *provided there are no cycles*.

# Turning it off
A nice property of this approach is that it's trivially easy to re-enable mutability if you so choose - simply 
unwrap the callback and replace references to both `staging` and `newObject` with references to `object`.

# Limitations
Currently only supports plain objects - no `seamless-immutable` or `ImmutableJS` yet. If there's interest I could 
look into it. Worth noting that although both libraries would perhaps improve safety and almost definitely improve 
performance, we'd lose the easy reversability we get from using regular objects.
