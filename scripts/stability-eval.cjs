"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/graphology-utils/defaults.js
var require_defaults = __commonJS({
  "node_modules/graphology-utils/defaults.js"(exports2, module2) {
    function isLeaf(o) {
      return !o || typeof o !== "object" || typeof o === "function" || Array.isArray(o) || o instanceof Set || o instanceof Map || o instanceof RegExp || o instanceof Date;
    }
    function resolveDefaults(target, defaults) {
      target = target || {};
      var output = {};
      for (var k in defaults) {
        var existing = target[k];
        var def = defaults[k];
        if (!isLeaf(def)) {
          output[k] = resolveDefaults(existing, def);
          continue;
        }
        if (existing === void 0) {
          output[k] = def;
        } else {
          output[k] = existing;
        }
      }
      return output;
    }
    module2.exports = resolveDefaults;
  }
});

// node_modules/graphology-utils/is-graph.js
var require_is_graph = __commonJS({
  "node_modules/graphology-utils/is-graph.js"(exports2, module2) {
    module2.exports = function isGraph(value) {
      return value !== null && typeof value === "object" && typeof value.addUndirectedEdgeWithKey === "function" && typeof value.dropNode === "function" && typeof value.multi === "boolean";
    };
  }
});

// node_modules/graphology-utils/infer-type.js
var require_infer_type = __commonJS({
  "node_modules/graphology-utils/infer-type.js"(exports2, module2) {
    var isGraph = require_is_graph();
    module2.exports = function inferType(graph) {
      if (!isGraph(graph))
        throw new Error(
          "graphology-utils/infer-type: expecting a valid graphology instance."
        );
      var declaredType = graph.type;
      if (declaredType !== "mixed") return declaredType;
      if (graph.directedSize === 0 && graph.undirectedSize === 0 || graph.directedSize > 0 && graph.undirectedSize > 0)
        return "mixed";
      if (graph.directedSize > 0) return "directed";
      return "undirected";
    };
  }
});

// node_modules/obliterator/iterator.js
var require_iterator = __commonJS({
  "node_modules/obliterator/iterator.js"(exports2, module2) {
    function Iterator(next) {
      if (typeof next !== "function")
        throw new Error("obliterator/iterator: expecting a function!");
      this.next = next;
    }
    if (typeof Symbol !== "undefined")
      Iterator.prototype[Symbol.iterator] = function() {
        return this;
      };
    Iterator.of = function() {
      var args = arguments, l = args.length, i = 0;
      return new Iterator(function() {
        if (i >= l) return { done: true };
        return { done: false, value: args[i++] };
      });
    };
    Iterator.empty = function() {
      var iterator = new Iterator(function() {
        return { done: true };
      });
      return iterator;
    };
    Iterator.fromSequence = function(sequence) {
      var i = 0, l = sequence.length;
      return new Iterator(function() {
        if (i >= l) return { done: true };
        return { done: false, value: sequence[i++] };
      });
    };
    Iterator.is = function(value) {
      if (value instanceof Iterator) return true;
      return typeof value === "object" && value !== null && typeof value.next === "function";
    };
    module2.exports = Iterator;
  }
});

// node_modules/mnemonist/utils/typed-arrays.js
var require_typed_arrays = __commonJS({
  "node_modules/mnemonist/utils/typed-arrays.js"(exports2) {
    var MAX_8BIT_INTEGER = Math.pow(2, 8) - 1;
    var MAX_16BIT_INTEGER = Math.pow(2, 16) - 1;
    var MAX_32BIT_INTEGER = Math.pow(2, 32) - 1;
    var MAX_SIGNED_8BIT_INTEGER = Math.pow(2, 7) - 1;
    var MAX_SIGNED_16BIT_INTEGER = Math.pow(2, 15) - 1;
    var MAX_SIGNED_32BIT_INTEGER = Math.pow(2, 31) - 1;
    exports2.getPointerArray = function(size) {
      var maxIndex = size - 1;
      if (maxIndex <= MAX_8BIT_INTEGER)
        return Uint8Array;
      if (maxIndex <= MAX_16BIT_INTEGER)
        return Uint16Array;
      if (maxIndex <= MAX_32BIT_INTEGER)
        return Uint32Array;
      throw new Error("mnemonist: Pointer Array of size > 4294967295 is not supported.");
    };
    exports2.getSignedPointerArray = function(size) {
      var maxIndex = size - 1;
      if (maxIndex <= MAX_SIGNED_8BIT_INTEGER)
        return Int8Array;
      if (maxIndex <= MAX_SIGNED_16BIT_INTEGER)
        return Int16Array;
      if (maxIndex <= MAX_SIGNED_32BIT_INTEGER)
        return Int32Array;
      return Float64Array;
    };
    exports2.getNumberType = function(value) {
      if (value === (value | 0)) {
        if (Math.sign(value) === -1) {
          if (value <= 127 && value >= -128)
            return Int8Array;
          if (value <= 32767 && value >= -32768)
            return Int16Array;
          return Int32Array;
        } else {
          if (value <= 255)
            return Uint8Array;
          if (value <= 65535)
            return Uint16Array;
          return Uint32Array;
        }
      }
      return Float64Array;
    };
    var TYPE_PRIORITY = {
      Uint8Array: 1,
      Int8Array: 2,
      Uint16Array: 3,
      Int16Array: 4,
      Uint32Array: 5,
      Int32Array: 6,
      Float32Array: 7,
      Float64Array: 8
    };
    exports2.getMinimalRepresentation = function(array, getter) {
      var maxType = null, maxPriority = 0, p, t, v, i, l;
      for (i = 0, l = array.length; i < l; i++) {
        v = getter ? getter(array[i]) : array[i];
        t = exports2.getNumberType(v);
        p = TYPE_PRIORITY[t.name];
        if (p > maxPriority) {
          maxPriority = p;
          maxType = t;
        }
      }
      return maxType;
    };
    exports2.isTypedArray = function(value) {
      return typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value);
    };
    exports2.concat = function() {
      var length = 0, i, o, l;
      for (i = 0, l = arguments.length; i < l; i++)
        length += arguments[i].length;
      var array = new arguments[0].constructor(length);
      for (i = 0, o = 0; i < l; i++) {
        array.set(arguments[i], o);
        o += arguments[i].length;
      }
      return array;
    };
    exports2.indices = function(length) {
      var PointerArray = exports2.getPointerArray(length);
      var array = new PointerArray(length);
      for (var i = 0; i < length; i++)
        array[i] = i;
      return array;
    };
  }
});

// node_modules/mnemonist/sparse-map.js
var require_sparse_map = __commonJS({
  "node_modules/mnemonist/sparse-map.js"(exports2, module2) {
    var Iterator = require_iterator();
    var getPointerArray = require_typed_arrays().getPointerArray;
    function SparseMap(Values, length) {
      if (arguments.length < 2) {
        length = Values;
        Values = Array;
      }
      var ByteArray = getPointerArray(length);
      this.size = 0;
      this.length = length;
      this.dense = new ByteArray(length);
      this.sparse = new ByteArray(length);
      this.vals = new Values(length);
    }
    SparseMap.prototype.clear = function() {
      this.size = 0;
    };
    SparseMap.prototype.has = function(member) {
      var index = this.sparse[member];
      return index < this.size && this.dense[index] === member;
    };
    SparseMap.prototype.get = function(member) {
      var index = this.sparse[member];
      if (index < this.size && this.dense[index] === member)
        return this.vals[index];
      return;
    };
    SparseMap.prototype.set = function(member, value) {
      var index = this.sparse[member];
      if (index < this.size && this.dense[index] === member) {
        this.vals[index] = value;
        return this;
      }
      this.dense[this.size] = member;
      this.sparse[member] = this.size;
      this.vals[this.size] = value;
      this.size++;
      return this;
    };
    SparseMap.prototype.delete = function(member) {
      var index = this.sparse[member];
      if (index >= this.size || this.dense[index] !== member)
        return false;
      index = this.dense[this.size - 1];
      this.dense[this.sparse[member]] = index;
      this.sparse[index] = this.sparse[member];
      this.size--;
      return true;
    };
    SparseMap.prototype.forEach = function(callback, scope) {
      scope = arguments.length > 1 ? scope : this;
      for (var i = 0; i < this.size; i++)
        callback.call(scope, this.vals[i], this.dense[i]);
    };
    SparseMap.prototype.keys = function() {
      var size = this.size, dense = this.dense, i = 0;
      return new Iterator(function() {
        if (i < size) {
          var item = dense[i];
          i++;
          return {
            value: item
          };
        }
        return {
          done: true
        };
      });
    };
    SparseMap.prototype.values = function() {
      var size = this.size, values = this.vals, i = 0;
      return new Iterator(function() {
        if (i < size) {
          var item = values[i];
          i++;
          return {
            value: item
          };
        }
        return {
          done: true
        };
      });
    };
    SparseMap.prototype.entries = function() {
      var size = this.size, dense = this.dense, values = this.vals, i = 0;
      return new Iterator(function() {
        if (i < size) {
          var item = [dense[i], values[i]];
          i++;
          return {
            value: item
          };
        }
        return {
          done: true
        };
      });
    };
    if (typeof Symbol !== "undefined")
      SparseMap.prototype[Symbol.iterator] = SparseMap.prototype.entries;
    SparseMap.prototype.inspect = function() {
      var proxy = /* @__PURE__ */ new Map();
      for (var i = 0; i < this.size; i++)
        proxy.set(this.dense[i], this.vals[i]);
      Object.defineProperty(proxy, "constructor", {
        value: SparseMap,
        enumerable: false
      });
      proxy.length = this.length;
      if (this.vals.constructor !== Array)
        proxy.type = this.vals.constructor.name;
      return proxy;
    };
    if (typeof Symbol !== "undefined")
      SparseMap.prototype[Symbol.for("nodejs.util.inspect.custom")] = SparseMap.prototype.inspect;
    module2.exports = SparseMap;
  }
});

// node_modules/mnemonist/sparse-queue-set.js
var require_sparse_queue_set = __commonJS({
  "node_modules/mnemonist/sparse-queue-set.js"(exports2, module2) {
    var Iterator = require_iterator();
    var getPointerArray = require_typed_arrays().getPointerArray;
    function SparseQueueSet(capacity) {
      var ByteArray = getPointerArray(capacity);
      this.start = 0;
      this.size = 0;
      this.capacity = capacity;
      this.dense = new ByteArray(capacity);
      this.sparse = new ByteArray(capacity);
    }
    SparseQueueSet.prototype.clear = function() {
      this.start = 0;
      this.size = 0;
    };
    SparseQueueSet.prototype.has = function(member) {
      if (this.size === 0)
        return false;
      var index = this.sparse[member];
      var inBounds = index < this.capacity && (index >= this.start && index < this.start + this.size) || index < (this.start + this.size) % this.capacity;
      return inBounds && this.dense[index] === member;
    };
    SparseQueueSet.prototype.enqueue = function(member) {
      var index = this.sparse[member];
      if (this.size !== 0) {
        var inBounds = index < this.capacity && (index >= this.start && index < this.start + this.size) || index < (this.start + this.size) % this.capacity;
        if (inBounds && this.dense[index] === member)
          return this;
      }
      index = (this.start + this.size) % this.capacity;
      this.dense[index] = member;
      this.sparse[member] = index;
      this.size++;
      return this;
    };
    SparseQueueSet.prototype.dequeue = function() {
      if (this.size === 0)
        return;
      var index = this.start;
      this.size--;
      this.start++;
      if (this.start === this.capacity)
        this.start = 0;
      var member = this.dense[index];
      this.sparse[member] = this.capacity;
      return member;
    };
    SparseQueueSet.prototype.forEach = function(callback, scope) {
      scope = arguments.length > 1 ? scope : this;
      var c = this.capacity, l = this.size, i = this.start, j = 0;
      while (j < l) {
        callback.call(scope, this.dense[i], j, this);
        i++;
        j++;
        if (i === c)
          i = 0;
      }
    };
    SparseQueueSet.prototype.values = function() {
      var dense = this.dense, c = this.capacity, l = this.size, i = this.start, j = 0;
      return new Iterator(function() {
        if (j >= l)
          return {
            done: true
          };
        var value = dense[i];
        i++;
        j++;
        if (i === c)
          i = 0;
        return {
          value,
          done: false
        };
      });
    };
    if (typeof Symbol !== "undefined")
      SparseQueueSet.prototype[Symbol.iterator] = SparseQueueSet.prototype.values;
    SparseQueueSet.prototype.inspect = function() {
      var proxy = [];
      this.forEach(function(member) {
        proxy.push(member);
      });
      Object.defineProperty(proxy, "constructor", {
        value: SparseQueueSet,
        enumerable: false
      });
      proxy.capacity = this.capacity;
      return proxy;
    };
    if (typeof Symbol !== "undefined")
      SparseQueueSet.prototype[Symbol.for("nodejs.util.inspect.custom")] = SparseQueueSet.prototype.inspect;
    module2.exports = SparseQueueSet;
  }
});

// node_modules/pandemonium/random-index.js
var require_random_index = __commonJS({
  "node_modules/pandemonium/random-index.js"(exports2, module2) {
    function createRandomIndex(rng) {
      return function(length) {
        if (typeof length !== "number") length = length.length;
        return Math.floor(rng() * length);
      };
    }
    var randomIndex = createRandomIndex(Math.random);
    randomIndex.createRandomIndex = createRandomIndex;
    module2.exports = randomIndex;
  }
});

// node_modules/graphology-utils/getters.js
var require_getters = __commonJS({
  "node_modules/graphology-utils/getters.js"(exports2) {
    function coerceWeight(value) {
      if (typeof value !== "number" || isNaN(value)) return 1;
      return value;
    }
    function createNodeValueGetter(nameOrFunction, defaultValue) {
      var getter = {};
      var coerceToDefault = function(v) {
        if (typeof v === "undefined") return defaultValue;
        return v;
      };
      if (typeof defaultValue === "function") coerceToDefault = defaultValue;
      var get = function(attributes) {
        return coerceToDefault(attributes[nameOrFunction]);
      };
      var returnDefault = function() {
        return coerceToDefault(void 0);
      };
      if (typeof nameOrFunction === "string") {
        getter.fromAttributes = get;
        getter.fromGraph = function(graph, node) {
          return get(graph.getNodeAttributes(node));
        };
        getter.fromEntry = function(node, attributes) {
          return get(attributes);
        };
      } else if (typeof nameOrFunction === "function") {
        getter.fromAttributes = function() {
          throw new Error(
            "graphology-utils/getters/createNodeValueGetter: irrelevant usage."
          );
        };
        getter.fromGraph = function(graph, node) {
          return coerceToDefault(
            nameOrFunction(node, graph.getNodeAttributes(node))
          );
        };
        getter.fromEntry = function(node, attributes) {
          return coerceToDefault(nameOrFunction(node, attributes));
        };
      } else {
        getter.fromAttributes = returnDefault;
        getter.fromGraph = returnDefault;
        getter.fromEntry = returnDefault;
      }
      return getter;
    }
    function createEdgeValueGetter(nameOrFunction, defaultValue) {
      var getter = {};
      var coerceToDefault = function(v) {
        if (typeof v === "undefined") return defaultValue;
        return v;
      };
      if (typeof defaultValue === "function") coerceToDefault = defaultValue;
      var get = function(attributes) {
        return coerceToDefault(attributes[nameOrFunction]);
      };
      var returnDefault = function() {
        return coerceToDefault(void 0);
      };
      if (typeof nameOrFunction === "string") {
        getter.fromAttributes = get;
        getter.fromGraph = function(graph, edge) {
          return get(graph.getEdgeAttributes(edge));
        };
        getter.fromEntry = function(edge, attributes) {
          return get(attributes);
        };
        getter.fromPartialEntry = getter.fromEntry;
        getter.fromMinimalEntry = getter.fromEntry;
      } else if (typeof nameOrFunction === "function") {
        getter.fromAttributes = function() {
          throw new Error(
            "graphology-utils/getters/createEdgeValueGetter: irrelevant usage."
          );
        };
        getter.fromGraph = function(graph, edge) {
          var extremities = graph.extremities(edge);
          return coerceToDefault(
            nameOrFunction(
              edge,
              graph.getEdgeAttributes(edge),
              extremities[0],
              extremities[1],
              graph.getNodeAttributes(extremities[0]),
              graph.getNodeAttributes(extremities[1]),
              graph.isUndirected(edge)
            )
          );
        };
        getter.fromEntry = function(e, a, s, t, sa, ta, u) {
          return coerceToDefault(nameOrFunction(e, a, s, t, sa, ta, u));
        };
        getter.fromPartialEntry = function(e, a, s, t) {
          return coerceToDefault(nameOrFunction(e, a, s, t));
        };
        getter.fromMinimalEntry = function(e, a) {
          return coerceToDefault(nameOrFunction(e, a));
        };
      } else {
        getter.fromAttributes = returnDefault;
        getter.fromGraph = returnDefault;
        getter.fromEntry = returnDefault;
        getter.fromMinimalEntry = returnDefault;
      }
      return getter;
    }
    exports2.createNodeValueGetter = createNodeValueGetter;
    exports2.createEdgeValueGetter = createEdgeValueGetter;
    exports2.createEdgeWeightGetter = function(name) {
      return createEdgeValueGetter(name, coerceWeight);
    };
  }
});

// node_modules/graphology-indices/louvain.js
var require_louvain = __commonJS({
  "node_modules/graphology-indices/louvain.js"(exports2) {
    var typed = require_typed_arrays();
    var resolveDefaults = require_defaults();
    var createEdgeWeightGetter = require_getters().createEdgeWeightGetter;
    var INSPECT = Symbol.for("nodejs.util.inspect.custom");
    var DEFAULTS2 = {
      getEdgeWeight: "weight",
      keepDendrogram: false,
      resolution: 1
    };
    function UndirectedLouvainIndex(graph, options) {
      options = resolveDefaults(options, DEFAULTS2);
      var resolution = options.resolution;
      var getEdgeWeight = createEdgeWeightGetter(options.getEdgeWeight).fromEntry;
      var size = (graph.size - graph.selfLoopCount) * 2;
      var NeighborhoodPointerArray = typed.getPointerArray(size);
      var NodesPointerArray = typed.getPointerArray(graph.order + 1);
      var WeightsArray = options.getEdgeWeight ? Float64Array : typed.getPointerArray(graph.size * 2);
      this.C = graph.order;
      this.M = 0;
      this.E = size;
      this.U = 0;
      this.resolution = resolution;
      this.level = 0;
      this.graph = graph;
      this.nodes = new Array(graph.order);
      this.keepDendrogram = options.keepDendrogram;
      this.neighborhood = new NodesPointerArray(size);
      this.weights = new WeightsArray(size);
      this.loops = new WeightsArray(graph.order);
      this.starts = new NeighborhoodPointerArray(graph.order + 1);
      this.belongings = new NodesPointerArray(graph.order);
      this.dendrogram = [];
      this.mapping = null;
      this.counts = new NodesPointerArray(graph.order);
      this.unused = new NodesPointerArray(graph.order);
      this.totalWeights = new WeightsArray(graph.order);
      var ids = {};
      var weight;
      var i = 0, n = 0;
      var self = this;
      graph.forEachNode(function(node) {
        self.nodes[i] = node;
        ids[node] = i;
        n += graph.undirectedDegreeWithoutSelfLoops(node);
        self.starts[i] = n;
        self.belongings[i] = i;
        self.counts[i] = 1;
        i++;
      });
      graph.forEachEdge(function(edge, attr, source, target, sa, ta, u) {
        weight = getEdgeWeight(edge, attr, source, target, sa, ta, u);
        source = ids[source];
        target = ids[target];
        self.M += weight;
        if (source === target) {
          self.totalWeights[source] += weight * 2;
          self.loops[source] = weight * 2;
        } else {
          self.totalWeights[source] += weight;
          self.totalWeights[target] += weight;
          var startSource = --self.starts[source], startTarget = --self.starts[target];
          self.neighborhood[startSource] = target;
          self.neighborhood[startTarget] = source;
          self.weights[startSource] = weight;
          self.weights[startTarget] = weight;
        }
      });
      this.starts[i] = this.E;
      if (this.keepDendrogram) this.dendrogram.push(this.belongings.slice());
      else this.mapping = this.belongings.slice();
    }
    UndirectedLouvainIndex.prototype.isolate = function(i, degree) {
      var currentCommunity = this.belongings[i];
      if (this.counts[currentCommunity] === 1) return currentCommunity;
      var newCommunity = this.unused[--this.U];
      var loops = this.loops[i];
      this.totalWeights[currentCommunity] -= degree + loops;
      this.totalWeights[newCommunity] += degree + loops;
      this.belongings[i] = newCommunity;
      this.counts[currentCommunity]--;
      this.counts[newCommunity]++;
      return newCommunity;
    };
    UndirectedLouvainIndex.prototype.move = function(i, degree, targetCommunity) {
      var currentCommunity = this.belongings[i], loops = this.loops[i];
      this.totalWeights[currentCommunity] -= degree + loops;
      this.totalWeights[targetCommunity] += degree + loops;
      this.belongings[i] = targetCommunity;
      var nowEmpty = this.counts[currentCommunity]-- === 1;
      this.counts[targetCommunity]++;
      if (nowEmpty) this.unused[this.U++] = currentCommunity;
    };
    UndirectedLouvainIndex.prototype.computeNodeDegree = function(i) {
      var o, l, weight;
      var degree = 0;
      for (o = this.starts[i], l = this.starts[i + 1]; o < l; o++) {
        weight = this.weights[o];
        degree += weight;
      }
      return degree;
    };
    UndirectedLouvainIndex.prototype.expensiveIsolate = function(i) {
      var degree = this.computeNodeDegree(i);
      return this.isolate(i, degree);
    };
    UndirectedLouvainIndex.prototype.expensiveMove = function(i, ci) {
      var degree = this.computeNodeDegree(i);
      this.move(i, degree, ci);
    };
    UndirectedLouvainIndex.prototype.zoomOut = function() {
      var inducedGraph = new Array(this.C - this.U), newLabels = {};
      var N = this.nodes.length;
      var C = 0, E = 0;
      var i, j, l, m, n, ci, cj, data, adj;
      for (i = 0, l = this.C; i < l; i++) {
        ci = this.belongings[i];
        if (!(ci in newLabels)) {
          newLabels[ci] = C;
          inducedGraph[C] = {
            adj: {},
            totalWeights: this.totalWeights[ci],
            internalWeights: 0
          };
          C++;
        }
        this.belongings[i] = newLabels[ci];
      }
      var currentLevel, nextLevel;
      if (this.keepDendrogram) {
        currentLevel = this.dendrogram[this.level];
        nextLevel = new (typed.getPointerArray(C))(N);
        for (i = 0; i < N; i++) nextLevel[i] = this.belongings[currentLevel[i]];
        this.dendrogram.push(nextLevel);
      } else {
        for (i = 0; i < N; i++) this.mapping[i] = this.belongings[this.mapping[i]];
      }
      for (i = 0, l = this.C; i < l; i++) {
        ci = this.belongings[i];
        data = inducedGraph[ci];
        adj = data.adj;
        data.internalWeights += this.loops[i];
        for (j = this.starts[i], m = this.starts[i + 1]; j < m; j++) {
          n = this.neighborhood[j];
          cj = this.belongings[n];
          if (ci === cj) {
            data.internalWeights += this.weights[j];
            continue;
          }
          if (!(cj in adj)) adj[cj] = 0;
          adj[cj] += this.weights[j];
        }
      }
      this.C = C;
      n = 0;
      for (ci = 0; ci < C; ci++) {
        data = inducedGraph[ci];
        adj = data.adj;
        ci = +ci;
        this.totalWeights[ci] = data.totalWeights;
        this.loops[ci] = data.internalWeights;
        this.counts[ci] = 1;
        this.starts[ci] = n;
        this.belongings[ci] = ci;
        for (cj in adj) {
          this.neighborhood[n] = +cj;
          this.weights[n] = adj[cj];
          E++;
          n++;
        }
      }
      this.starts[C] = E;
      this.E = E;
      this.U = 0;
      this.level++;
      return newLabels;
    };
    UndirectedLouvainIndex.prototype.modularity = function() {
      var ci, cj, i, j, m;
      var Q = 0;
      var M2 = this.M * 2;
      var internalWeights = new Float64Array(this.C);
      for (i = 0; i < this.C; i++) {
        ci = this.belongings[i];
        internalWeights[ci] += this.loops[i];
        for (j = this.starts[i], m = this.starts[i + 1]; j < m; j++) {
          cj = this.belongings[this.neighborhood[j]];
          if (ci !== cj) continue;
          internalWeights[ci] += this.weights[j];
        }
      }
      for (i = 0; i < this.C; i++) {
        Q += internalWeights[i] / M2 - Math.pow(this.totalWeights[i] / M2, 2) * this.resolution;
      }
      return Q;
    };
    UndirectedLouvainIndex.prototype.delta = function(i, degree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalWeight = this.totalWeights[targetCommunity];
      degree += this.loops[i];
      return targetCommunityDegree / M - // NOTE: formula is a bit different here because targetCommunityDegree is passed without * 2
      targetCommunityTotalWeight * degree * this.resolution / (2 * M * M);
    };
    UndirectedLouvainIndex.prototype.deltaWithOwnCommunity = function(i, degree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalWeight = this.totalWeights[targetCommunity];
      degree += this.loops[i];
      return targetCommunityDegree / M - // NOTE: formula is a bit different here because targetCommunityDegree is passed without * 2
      (targetCommunityTotalWeight - degree) * degree * this.resolution / (2 * M * M);
    };
    UndirectedLouvainIndex.prototype.fastDelta = function(i, degree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalWeight = this.totalWeights[targetCommunity];
      degree += this.loops[i];
      return targetCommunityDegree - degree * targetCommunityTotalWeight * this.resolution / (2 * M);
    };
    UndirectedLouvainIndex.prototype.fastDeltaWithOwnCommunity = function(i, degree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalWeight = this.totalWeights[targetCommunity];
      degree += this.loops[i];
      return targetCommunityDegree - degree * (targetCommunityTotalWeight - degree) * this.resolution / (2 * M);
    };
    UndirectedLouvainIndex.prototype.bounds = function(i) {
      return [this.starts[i], this.starts[i + 1]];
    };
    UndirectedLouvainIndex.prototype.project = function() {
      var self = this;
      var projection = {};
      self.nodes.slice(0, this.C).forEach(function(node, i) {
        projection[node] = Array.from(
          self.neighborhood.slice(self.starts[i], self.starts[i + 1])
        ).map(function(j) {
          return self.nodes[j];
        });
      });
      return projection;
    };
    UndirectedLouvainIndex.prototype.collect = function(level) {
      if (arguments.length < 1) level = this.level;
      var o = {};
      var mapping = this.keepDendrogram ? this.dendrogram[level] : this.mapping;
      var i, l;
      for (i = 0, l = mapping.length; i < l; i++) o[this.nodes[i]] = mapping[i];
      return o;
    };
    UndirectedLouvainIndex.prototype.assign = function(prop, level) {
      if (arguments.length < 2) level = this.level;
      var mapping = this.keepDendrogram ? this.dendrogram[level] : this.mapping;
      var i, l;
      for (i = 0, l = mapping.length; i < l; i++)
        this.graph.setNodeAttribute(this.nodes[i], prop, mapping[i]);
    };
    UndirectedLouvainIndex.prototype[INSPECT] = function() {
      var proxy = {};
      Object.defineProperty(proxy, "constructor", {
        value: UndirectedLouvainIndex,
        enumerable: false
      });
      proxy.C = this.C;
      proxy.M = this.M;
      proxy.E = this.E;
      proxy.U = this.U;
      proxy.resolution = this.resolution;
      proxy.level = this.level;
      proxy.nodes = this.nodes;
      proxy.starts = this.starts.slice(0, proxy.C + 1);
      var eTruncated = ["neighborhood", "weights"];
      var cTruncated = ["counts", "loops", "belongings", "totalWeights"];
      var self = this;
      eTruncated.forEach(function(key) {
        proxy[key] = self[key].slice(0, proxy.E);
      });
      cTruncated.forEach(function(key) {
        proxy[key] = self[key].slice(0, proxy.C);
      });
      proxy.unused = this.unused.slice(0, this.U);
      if (this.keepDendrogram) proxy.dendrogram = this.dendrogram;
      else proxy.mapping = this.mapping;
      return proxy;
    };
    function DirectedLouvainIndex(graph, options) {
      options = resolveDefaults(options, DEFAULTS2);
      var resolution = options.resolution;
      var getEdgeWeight = createEdgeWeightGetter(options.getEdgeWeight).fromEntry;
      var size = (graph.size - graph.selfLoopCount) * 2;
      var NeighborhoodPointerArray = typed.getPointerArray(size);
      var NodesPointerArray = typed.getPointerArray(graph.order + 1);
      var WeightsArray = options.getEdgeWeight ? Float64Array : typed.getPointerArray(graph.size * 2);
      this.C = graph.order;
      this.M = 0;
      this.E = size;
      this.U = 0;
      this.resolution = resolution;
      this.level = 0;
      this.graph = graph;
      this.nodes = new Array(graph.order);
      this.keepDendrogram = options.keepDendrogram;
      this.neighborhood = new NodesPointerArray(size);
      this.weights = new WeightsArray(size);
      this.loops = new WeightsArray(graph.order);
      this.starts = new NeighborhoodPointerArray(graph.order + 1);
      this.offsets = new NeighborhoodPointerArray(graph.order);
      this.belongings = new NodesPointerArray(graph.order);
      this.dendrogram = [];
      this.counts = new NodesPointerArray(graph.order);
      this.unused = new NodesPointerArray(graph.order);
      this.totalInWeights = new WeightsArray(graph.order);
      this.totalOutWeights = new WeightsArray(graph.order);
      var ids = {};
      var weight;
      var i = 0, n = 0;
      var self = this;
      graph.forEachNode(function(node) {
        self.nodes[i] = node;
        ids[node] = i;
        n += graph.outDegreeWithoutSelfLoops(node);
        self.starts[i] = n;
        n += graph.inDegreeWithoutSelfLoops(node);
        self.offsets[i] = n;
        self.belongings[i] = i;
        self.counts[i] = 1;
        i++;
      });
      graph.forEachEdge(function(edge, attr, source, target, sa, ta, u) {
        weight = getEdgeWeight(edge, attr, source, target, sa, ta, u);
        source = ids[source];
        target = ids[target];
        self.M += weight;
        if (source === target) {
          self.loops[source] += weight;
          self.totalInWeights[source] += weight;
          self.totalOutWeights[source] += weight;
        } else {
          self.totalOutWeights[source] += weight;
          self.totalInWeights[target] += weight;
          var startSource = --self.starts[source], startTarget = --self.offsets[target];
          self.neighborhood[startSource] = target;
          self.neighborhood[startTarget] = source;
          self.weights[startSource] = weight;
          self.weights[startTarget] = weight;
        }
      });
      this.starts[i] = this.E;
      if (this.keepDendrogram) this.dendrogram.push(this.belongings.slice());
      else this.mapping = this.belongings.slice();
    }
    DirectedLouvainIndex.prototype.bounds = UndirectedLouvainIndex.prototype.bounds;
    DirectedLouvainIndex.prototype.inBounds = function(i) {
      return [this.offsets[i], this.starts[i + 1]];
    };
    DirectedLouvainIndex.prototype.outBounds = function(i) {
      return [this.starts[i], this.offsets[i]];
    };
    DirectedLouvainIndex.prototype.project = UndirectedLouvainIndex.prototype.project;
    DirectedLouvainIndex.prototype.projectIn = function() {
      var self = this;
      var projection = {};
      self.nodes.slice(0, this.C).forEach(function(node, i) {
        projection[node] = Array.from(
          self.neighborhood.slice(self.offsets[i], self.starts[i + 1])
        ).map(function(j) {
          return self.nodes[j];
        });
      });
      return projection;
    };
    DirectedLouvainIndex.prototype.projectOut = function() {
      var self = this;
      var projection = {};
      self.nodes.slice(0, this.C).forEach(function(node, i) {
        projection[node] = Array.from(
          self.neighborhood.slice(self.starts[i], self.offsets[i])
        ).map(function(j) {
          return self.nodes[j];
        });
      });
      return projection;
    };
    DirectedLouvainIndex.prototype.isolate = function(i, inDegree, outDegree) {
      var currentCommunity = this.belongings[i];
      if (this.counts[currentCommunity] === 1) return currentCommunity;
      var newCommunity = this.unused[--this.U];
      var loops = this.loops[i];
      this.totalInWeights[currentCommunity] -= inDegree + loops;
      this.totalInWeights[newCommunity] += inDegree + loops;
      this.totalOutWeights[currentCommunity] -= outDegree + loops;
      this.totalOutWeights[newCommunity] += outDegree + loops;
      this.belongings[i] = newCommunity;
      this.counts[currentCommunity]--;
      this.counts[newCommunity]++;
      return newCommunity;
    };
    DirectedLouvainIndex.prototype.move = function(i, inDegree, outDegree, targetCommunity) {
      var currentCommunity = this.belongings[i], loops = this.loops[i];
      this.totalInWeights[currentCommunity] -= inDegree + loops;
      this.totalInWeights[targetCommunity] += inDegree + loops;
      this.totalOutWeights[currentCommunity] -= outDegree + loops;
      this.totalOutWeights[targetCommunity] += outDegree + loops;
      this.belongings[i] = targetCommunity;
      var nowEmpty = this.counts[currentCommunity]-- === 1;
      this.counts[targetCommunity]++;
      if (nowEmpty) this.unused[this.U++] = currentCommunity;
    };
    DirectedLouvainIndex.prototype.computeNodeInDegree = function(i) {
      var o, l, weight;
      var inDegree = 0;
      for (o = this.offsets[i], l = this.starts[i + 1]; o < l; o++) {
        weight = this.weights[o];
        inDegree += weight;
      }
      return inDegree;
    };
    DirectedLouvainIndex.prototype.computeNodeOutDegree = function(i) {
      var o, l, weight;
      var outDegree = 0;
      for (o = this.starts[i], l = this.offsets[i]; o < l; o++) {
        weight = this.weights[o];
        outDegree += weight;
      }
      return outDegree;
    };
    DirectedLouvainIndex.prototype.expensiveMove = function(i, ci) {
      var inDegree = this.computeNodeInDegree(i), outDegree = this.computeNodeOutDegree(i);
      this.move(i, inDegree, outDegree, ci);
    };
    DirectedLouvainIndex.prototype.zoomOut = function() {
      var inducedGraph = new Array(this.C - this.U), newLabels = {};
      var N = this.nodes.length;
      var C = 0, E = 0;
      var i, j, l, m, n, ci, cj, data, offset, out, adj, inAdj, outAdj;
      for (i = 0, l = this.C; i < l; i++) {
        ci = this.belongings[i];
        if (!(ci in newLabels)) {
          newLabels[ci] = C;
          inducedGraph[C] = {
            inAdj: {},
            outAdj: {},
            totalInWeights: this.totalInWeights[ci],
            totalOutWeights: this.totalOutWeights[ci],
            internalWeights: 0
          };
          C++;
        }
        this.belongings[i] = newLabels[ci];
      }
      var currentLevel, nextLevel;
      if (this.keepDendrogram) {
        currentLevel = this.dendrogram[this.level];
        nextLevel = new (typed.getPointerArray(C))(N);
        for (i = 0; i < N; i++) nextLevel[i] = this.belongings[currentLevel[i]];
        this.dendrogram.push(nextLevel);
      } else {
        for (i = 0; i < N; i++) this.mapping[i] = this.belongings[this.mapping[i]];
      }
      for (i = 0, l = this.C; i < l; i++) {
        ci = this.belongings[i];
        offset = this.offsets[i];
        data = inducedGraph[ci];
        inAdj = data.inAdj;
        outAdj = data.outAdj;
        data.internalWeights += this.loops[i];
        for (j = this.starts[i], m = this.starts[i + 1]; j < m; j++) {
          n = this.neighborhood[j];
          cj = this.belongings[n];
          out = j < offset;
          adj = out ? outAdj : inAdj;
          if (ci === cj) {
            if (out) data.internalWeights += this.weights[j];
            continue;
          }
          if (!(cj in adj)) adj[cj] = 0;
          adj[cj] += this.weights[j];
        }
      }
      this.C = C;
      n = 0;
      for (ci = 0; ci < C; ci++) {
        data = inducedGraph[ci];
        inAdj = data.inAdj;
        outAdj = data.outAdj;
        ci = +ci;
        this.totalInWeights[ci] = data.totalInWeights;
        this.totalOutWeights[ci] = data.totalOutWeights;
        this.loops[ci] = data.internalWeights;
        this.counts[ci] = 1;
        this.starts[ci] = n;
        this.belongings[ci] = ci;
        for (cj in outAdj) {
          this.neighborhood[n] = +cj;
          this.weights[n] = outAdj[cj];
          E++;
          n++;
        }
        this.offsets[ci] = n;
        for (cj in inAdj) {
          this.neighborhood[n] = +cj;
          this.weights[n] = inAdj[cj];
          E++;
          n++;
        }
      }
      this.starts[C] = E;
      this.E = E;
      this.U = 0;
      this.level++;
      return newLabels;
    };
    DirectedLouvainIndex.prototype.modularity = function() {
      var ci, cj, i, j, m;
      var Q = 0;
      var M = this.M;
      var internalWeights = new Float64Array(this.C);
      for (i = 0; i < this.C; i++) {
        ci = this.belongings[i];
        internalWeights[ci] += this.loops[i];
        for (j = this.starts[i], m = this.offsets[i]; j < m; j++) {
          cj = this.belongings[this.neighborhood[j]];
          if (ci !== cj) continue;
          internalWeights[ci] += this.weights[j];
        }
      }
      for (i = 0; i < this.C; i++)
        Q += internalWeights[i] / M - this.totalInWeights[i] * this.totalOutWeights[i] / Math.pow(M, 2) * this.resolution;
      return Q;
    };
    DirectedLouvainIndex.prototype.delta = function(i, inDegree, outDegree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalInWeight = this.totalInWeights[targetCommunity], targetCommunityTotalOutWeight = this.totalOutWeights[targetCommunity];
      var loops = this.loops[i];
      inDegree += loops;
      outDegree += loops;
      return targetCommunityDegree / M - (outDegree * targetCommunityTotalInWeight + inDegree * targetCommunityTotalOutWeight) * this.resolution / (M * M);
    };
    DirectedLouvainIndex.prototype.deltaWithOwnCommunity = function(i, inDegree, outDegree, targetCommunityDegree, targetCommunity) {
      var M = this.M;
      var targetCommunityTotalInWeight = this.totalInWeights[targetCommunity], targetCommunityTotalOutWeight = this.totalOutWeights[targetCommunity];
      var loops = this.loops[i];
      inDegree += loops;
      outDegree += loops;
      return targetCommunityDegree / M - (outDegree * (targetCommunityTotalInWeight - inDegree) + inDegree * (targetCommunityTotalOutWeight - outDegree)) * this.resolution / (M * M);
    };
    DirectedLouvainIndex.prototype.collect = UndirectedLouvainIndex.prototype.collect;
    DirectedLouvainIndex.prototype.assign = UndirectedLouvainIndex.prototype.assign;
    DirectedLouvainIndex.prototype[INSPECT] = function() {
      var proxy = {};
      Object.defineProperty(proxy, "constructor", {
        value: DirectedLouvainIndex,
        enumerable: false
      });
      proxy.C = this.C;
      proxy.M = this.M;
      proxy.E = this.E;
      proxy.U = this.U;
      proxy.resolution = this.resolution;
      proxy.level = this.level;
      proxy.nodes = this.nodes;
      proxy.starts = this.starts.slice(0, proxy.C + 1);
      var eTruncated = ["neighborhood", "weights"];
      var cTruncated = [
        "counts",
        "offsets",
        "loops",
        "belongings",
        "totalInWeights",
        "totalOutWeights"
      ];
      var self = this;
      eTruncated.forEach(function(key) {
        proxy[key] = self[key].slice(0, proxy.E);
      });
      cTruncated.forEach(function(key) {
        proxy[key] = self[key].slice(0, proxy.C);
      });
      proxy.unused = this.unused.slice(0, this.U);
      if (this.keepDendrogram) proxy.dendrogram = this.dendrogram;
      else proxy.mapping = this.mapping;
      return proxy;
    };
    exports2.UndirectedLouvainIndex = UndirectedLouvainIndex;
    exports2.DirectedLouvainIndex = DirectedLouvainIndex;
  }
});

// node_modules/graphology-communities-louvain/index.js
var require_graphology_communities_louvain = __commonJS({
  "node_modules/graphology-communities-louvain/index.js"(exports2, module2) {
    var resolveDefaults = require_defaults();
    var isGraph = require_is_graph();
    var inferType = require_infer_type();
    var SparseMap = require_sparse_map();
    var SparseQueueSet = require_sparse_queue_set();
    var createRandomIndex = require_random_index().createRandomIndex;
    var indices = require_louvain();
    var UndirectedLouvainIndex = indices.UndirectedLouvainIndex;
    var DirectedLouvainIndex = indices.DirectedLouvainIndex;
    var DEFAULTS2 = {
      nodeCommunityAttribute: "community",
      getEdgeWeight: "weight",
      fastLocalMoves: true,
      randomWalk: true,
      resolution: 1,
      rng: Math.random
    };
    function addWeightToCommunity(map2, community, weight) {
      var currentWeight = map2.get(community);
      if (typeof currentWeight === "undefined") currentWeight = 0;
      currentWeight += weight;
      map2.set(community, currentWeight);
    }
    var EPSILON = 1e-10;
    function tieBreaker(bestCommunity, currentCommunity, targetCommunity, delta, bestDelta) {
      if (Math.abs(delta - bestDelta) < EPSILON) {
        if (bestCommunity === currentCommunity) {
          return false;
        } else {
          return targetCommunity > bestCommunity;
        }
      } else if (delta > bestDelta) {
        return true;
      }
      return false;
    }
    function undirectedLouvain(detailed, graph, options) {
      var index = new UndirectedLouvainIndex(graph, {
        getEdgeWeight: options.getEdgeWeight,
        keepDendrogram: detailed,
        resolution: options.resolution
      });
      var randomIndex = createRandomIndex(options.rng);
      var moveWasMade = true, localMoveWasMade = true;
      var currentCommunity, targetCommunity;
      var communities = new SparseMap(Float64Array, index.C);
      var queue, start, end, weight, ci, ri, s, i, j, l;
      var degree, targetCommunityDegree;
      var bestCommunity, bestDelta, deltaIsBetter, delta;
      var deltaComputations = 0, nodesVisited = 0, moves = [], localMoves, currentMoves;
      if (options.fastLocalMoves) queue = new SparseQueueSet(index.C);
      while (moveWasMade) {
        l = index.C;
        moveWasMade = false;
        localMoveWasMade = true;
        if (options.fastLocalMoves) {
          currentMoves = 0;
          ri = options.randomWalk ? randomIndex(l) : 0;
          for (s = 0; s < l; s++, ri++) {
            i = ri % l;
            queue.enqueue(i);
          }
          while (queue.size !== 0) {
            i = queue.dequeue();
            nodesVisited++;
            degree = 0;
            communities.clear();
            currentCommunity = index.belongings[i];
            start = index.starts[i];
            end = index.starts[i + 1];
            for (; start < end; start++) {
              j = index.neighborhood[start];
              weight = index.weights[start];
              targetCommunity = index.belongings[j];
              degree += weight;
              addWeightToCommunity(communities, targetCommunity, weight);
            }
            bestDelta = index.fastDeltaWithOwnCommunity(
              i,
              degree,
              communities.get(currentCommunity) || 0,
              currentCommunity
            );
            bestCommunity = currentCommunity;
            for (ci = 0; ci < communities.size; ci++) {
              targetCommunity = communities.dense[ci];
              if (targetCommunity === currentCommunity) continue;
              targetCommunityDegree = communities.vals[ci];
              deltaComputations++;
              delta = index.fastDelta(
                i,
                degree,
                targetCommunityDegree,
                targetCommunity
              );
              deltaIsBetter = tieBreaker(
                bestCommunity,
                currentCommunity,
                targetCommunity,
                delta,
                bestDelta
              );
              if (deltaIsBetter) {
                bestDelta = delta;
                bestCommunity = targetCommunity;
              }
            }
            if (bestDelta < 0) {
              bestCommunity = index.isolate(i, degree);
              if (bestCommunity === currentCommunity) continue;
            } else {
              if (bestCommunity === currentCommunity) {
                continue;
              } else {
                index.move(i, degree, bestCommunity);
              }
            }
            moveWasMade = true;
            currentMoves++;
            start = index.starts[i];
            end = index.starts[i + 1];
            for (; start < end; start++) {
              j = index.neighborhood[start];
              targetCommunity = index.belongings[j];
              if (targetCommunity !== bestCommunity) queue.enqueue(j);
            }
          }
          moves.push(currentMoves);
        } else {
          localMoves = [];
          moves.push(localMoves);
          while (localMoveWasMade) {
            localMoveWasMade = false;
            currentMoves = 0;
            ri = options.randomWalk ? randomIndex(l) : 0;
            for (s = 0; s < l; s++, ri++) {
              i = ri % l;
              nodesVisited++;
              degree = 0;
              communities.clear();
              currentCommunity = index.belongings[i];
              start = index.starts[i];
              end = index.starts[i + 1];
              for (; start < end; start++) {
                j = index.neighborhood[start];
                weight = index.weights[start];
                targetCommunity = index.belongings[j];
                degree += weight;
                addWeightToCommunity(communities, targetCommunity, weight);
              }
              bestDelta = index.fastDeltaWithOwnCommunity(
                i,
                degree,
                communities.get(currentCommunity) || 0,
                currentCommunity
              );
              bestCommunity = currentCommunity;
              for (ci = 0; ci < communities.size; ci++) {
                targetCommunity = communities.dense[ci];
                if (targetCommunity === currentCommunity) continue;
                targetCommunityDegree = communities.vals[ci];
                deltaComputations++;
                delta = index.fastDelta(
                  i,
                  degree,
                  targetCommunityDegree,
                  targetCommunity
                );
                deltaIsBetter = tieBreaker(
                  bestCommunity,
                  currentCommunity,
                  targetCommunity,
                  delta,
                  bestDelta
                );
                if (deltaIsBetter) {
                  bestDelta = delta;
                  bestCommunity = targetCommunity;
                }
              }
              if (bestDelta < 0) {
                bestCommunity = index.isolate(i, degree);
                if (bestCommunity === currentCommunity) continue;
              } else {
                if (bestCommunity === currentCommunity) {
                  continue;
                } else {
                  index.move(i, degree, bestCommunity);
                }
              }
              localMoveWasMade = true;
              currentMoves++;
            }
            localMoves.push(currentMoves);
            moveWasMade = localMoveWasMade || moveWasMade;
          }
        }
        if (moveWasMade) index.zoomOut();
      }
      var results = {
        index,
        deltaComputations,
        nodesVisited,
        moves
      };
      return results;
    }
    function directedLouvain(detailed, graph, options) {
      var index = new DirectedLouvainIndex(graph, {
        getEdgeWeight: options.getEdgeWeight,
        keepDendrogram: detailed,
        resolution: options.resolution
      });
      var randomIndex = createRandomIndex(options.rng);
      var moveWasMade = true, localMoveWasMade = true;
      var currentCommunity, targetCommunity;
      var communities = new SparseMap(Float64Array, index.C);
      var queue, start, end, offset, out, weight, ci, ri, s, i, j, l;
      var inDegree, outDegree, targetCommunityDegree;
      var bestCommunity, bestDelta, deltaIsBetter, delta;
      var deltaComputations = 0, nodesVisited = 0, moves = [], localMoves, currentMoves;
      if (options.fastLocalMoves) queue = new SparseQueueSet(index.C);
      while (moveWasMade) {
        l = index.C;
        moveWasMade = false;
        localMoveWasMade = true;
        if (options.fastLocalMoves) {
          currentMoves = 0;
          ri = options.randomWalk ? randomIndex(l) : 0;
          for (s = 0; s < l; s++, ri++) {
            i = ri % l;
            queue.enqueue(i);
          }
          while (queue.size !== 0) {
            i = queue.dequeue();
            nodesVisited++;
            inDegree = 0;
            outDegree = 0;
            communities.clear();
            currentCommunity = index.belongings[i];
            start = index.starts[i];
            end = index.starts[i + 1];
            offset = index.offsets[i];
            for (; start < end; start++) {
              out = start < offset;
              j = index.neighborhood[start];
              weight = index.weights[start];
              targetCommunity = index.belongings[j];
              if (out) outDegree += weight;
              else inDegree += weight;
              addWeightToCommunity(communities, targetCommunity, weight);
            }
            bestDelta = index.deltaWithOwnCommunity(
              i,
              inDegree,
              outDegree,
              communities.get(currentCommunity) || 0,
              currentCommunity
            );
            bestCommunity = currentCommunity;
            for (ci = 0; ci < communities.size; ci++) {
              targetCommunity = communities.dense[ci];
              if (targetCommunity === currentCommunity) continue;
              targetCommunityDegree = communities.vals[ci];
              deltaComputations++;
              delta = index.delta(
                i,
                inDegree,
                outDegree,
                targetCommunityDegree,
                targetCommunity
              );
              deltaIsBetter = tieBreaker(
                bestCommunity,
                currentCommunity,
                targetCommunity,
                delta,
                bestDelta
              );
              if (deltaIsBetter) {
                bestDelta = delta;
                bestCommunity = targetCommunity;
              }
            }
            if (bestDelta < 0) {
              bestCommunity = index.isolate(i, inDegree, outDegree);
              if (bestCommunity === currentCommunity) continue;
            } else {
              if (bestCommunity === currentCommunity) {
                continue;
              } else {
                index.move(i, inDegree, outDegree, bestCommunity);
              }
            }
            moveWasMade = true;
            currentMoves++;
            start = index.starts[i];
            end = index.starts[i + 1];
            for (; start < end; start++) {
              j = index.neighborhood[start];
              targetCommunity = index.belongings[j];
              if (targetCommunity !== bestCommunity) queue.enqueue(j);
            }
          }
          moves.push(currentMoves);
        } else {
          localMoves = [];
          moves.push(localMoves);
          while (localMoveWasMade) {
            localMoveWasMade = false;
            currentMoves = 0;
            ri = options.randomWalk ? randomIndex(l) : 0;
            for (s = 0; s < l; s++, ri++) {
              i = ri % l;
              nodesVisited++;
              inDegree = 0;
              outDegree = 0;
              communities.clear();
              currentCommunity = index.belongings[i];
              start = index.starts[i];
              end = index.starts[i + 1];
              offset = index.offsets[i];
              for (; start < end; start++) {
                out = start < offset;
                j = index.neighborhood[start];
                weight = index.weights[start];
                targetCommunity = index.belongings[j];
                if (out) outDegree += weight;
                else inDegree += weight;
                addWeightToCommunity(communities, targetCommunity, weight);
              }
              bestDelta = index.deltaWithOwnCommunity(
                i,
                inDegree,
                outDegree,
                communities.get(currentCommunity) || 0,
                currentCommunity
              );
              bestCommunity = currentCommunity;
              for (ci = 0; ci < communities.size; ci++) {
                targetCommunity = communities.dense[ci];
                if (targetCommunity === currentCommunity) continue;
                targetCommunityDegree = communities.vals[ci];
                deltaComputations++;
                delta = index.delta(
                  i,
                  inDegree,
                  outDegree,
                  targetCommunityDegree,
                  targetCommunity
                );
                deltaIsBetter = tieBreaker(
                  bestCommunity,
                  currentCommunity,
                  targetCommunity,
                  delta,
                  bestDelta
                );
                if (deltaIsBetter) {
                  bestDelta = delta;
                  bestCommunity = targetCommunity;
                }
              }
              if (bestDelta < 0) {
                bestCommunity = index.isolate(i, inDegree, outDegree);
                if (bestCommunity === currentCommunity) continue;
              } else {
                if (bestCommunity === currentCommunity) {
                  continue;
                } else {
                  index.move(i, inDegree, outDegree, bestCommunity);
                }
              }
              localMoveWasMade = true;
              currentMoves++;
            }
            localMoves.push(currentMoves);
            moveWasMade = localMoveWasMade || moveWasMade;
          }
        }
        if (moveWasMade) index.zoomOut();
      }
      var results = {
        index,
        deltaComputations,
        nodesVisited,
        moves
      };
      return results;
    }
    function louvain2(assign2, detailed, graph, options) {
      if (!isGraph(graph))
        throw new Error(
          "graphology-communities-louvain: the given graph is not a valid graphology instance."
        );
      var type2 = inferType(graph);
      if (type2 === "mixed")
        throw new Error(
          "graphology-communities-louvain: cannot run the algorithm on a true mixed graph."
        );
      options = resolveDefaults(options, DEFAULTS2);
      var c = 0;
      if (graph.size === 0) {
        if (assign2) {
          graph.forEachNode(function(node) {
            graph.setNodeAttribute(node, options.nodeCommunityAttribute, c++);
          });
          return;
        }
        var communities = {};
        graph.forEachNode(function(node) {
          communities[node] = c++;
        });
        if (!detailed) return communities;
        return {
          communities,
          count: graph.order,
          deltaComputations: 0,
          dendrogram: null,
          level: 0,
          modularity: NaN,
          moves: null,
          nodesVisited: 0,
          resolution: options.resolution
        };
      }
      var fn2 = type2 === "undirected" ? undirectedLouvain : directedLouvain;
      var results = fn2(detailed, graph, options);
      var index = results.index;
      if (!detailed) {
        if (assign2) {
          index.assign(options.nodeCommunityAttribute);
          return;
        }
        return index.collect();
      }
      var output = {
        count: index.C,
        deltaComputations: results.deltaComputations,
        dendrogram: index.dendrogram,
        level: index.level,
        modularity: index.modularity(),
        moves: results.moves,
        nodesVisited: results.nodesVisited,
        resolution: options.resolution
      };
      if (assign2) {
        index.assign(options.nodeCommunityAttribute);
        return output;
      }
      output.communities = index.collect();
      return output;
    }
    var fn = louvain2.bind(null, false, false);
    fn.assign = louvain2.bind(null, true, false);
    fn.detailed = louvain2.bind(null, false, true);
    fn.defaults = DEFAULTS2;
    module2.exports = fn;
  }
});

// scripts/stability-eval.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);

// src/types.ts
var EMPTY_GRAPH = Object.freeze({
  nodes: [],
  edges: [],
  communities: [],
  nodeIndex: /* @__PURE__ */ new Map(),
  folders: [],
  builtAt: 0
});
var DEFAULT_RELEVANCE_WEIGHTS = {
  directLink: 4,
  commonNeighbor: 2,
  sourceOverlap: 2,
  coCitation: 1
};

// node_modules/graphology/dist/graphology.mjs
var import_events = require("events");
function assignPolyfill() {
  const target = arguments[0];
  for (let i = 1, l = arguments.length; i < l; i++) {
    if (!arguments[i]) continue;
    for (const k in arguments[i]) target[k] = arguments[i][k];
  }
  return target;
}
var assign = assignPolyfill;
if (typeof Object.assign === "function") assign = Object.assign;
function getMatchingEdge(graph, source, target, type2) {
  const sourceData = graph._nodes.get(source);
  let edge = null;
  if (!sourceData) return edge;
  if (type2 === "mixed") {
    edge = sourceData.out && sourceData.out[target] || sourceData.undirected && sourceData.undirected[target];
  } else if (type2 === "directed") {
    edge = sourceData.out && sourceData.out[target];
  } else {
    edge = sourceData.undirected && sourceData.undirected[target];
  }
  return edge;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null;
}
function isEmpty(o) {
  let k;
  for (k in o) return false;
  return true;
}
function privateProperty(target, name, value) {
  Object.defineProperty(target, name, {
    enumerable: false,
    configurable: false,
    writable: true,
    value
  });
}
function readOnlyProperty(target, name, value) {
  const descriptor = {
    enumerable: true,
    configurable: true
  };
  if (typeof value === "function") {
    descriptor.get = value;
  } else {
    descriptor.value = value;
    descriptor.writable = false;
  }
  Object.defineProperty(target, name, descriptor);
}
function validateHints(hints) {
  if (!isPlainObject(hints)) return false;
  if (hints.attributes && !Array.isArray(hints.attributes)) return false;
  return true;
}
function incrementalIdStartingFromRandomByte() {
  let i = Math.floor(Math.random() * 256) & 255;
  return () => {
    return i++;
  };
}
function chain() {
  const iterables = arguments;
  let current = null;
  let i = -1;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let step = null;
      do {
        if (current === null) {
          i++;
          if (i >= iterables.length) return { done: true };
          current = iterables[i][Symbol.iterator]();
        }
        step = current.next();
        if (step.done) {
          current = null;
          continue;
        }
        break;
      } while (true);
      return step;
    }
  };
}
function emptyIterator() {
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      return { done: true };
    }
  };
}
var GraphError = class extends Error {
  constructor(message) {
    super();
    this.name = "GraphError";
    this.message = message;
  }
};
var InvalidArgumentsGraphError = class _InvalidArgumentsGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "InvalidArgumentsGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(
        this,
        _InvalidArgumentsGraphError.prototype.constructor
      );
  }
};
var NotFoundGraphError = class _NotFoundGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "NotFoundGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(this, _NotFoundGraphError.prototype.constructor);
  }
};
var UsageGraphError = class _UsageGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "UsageGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(this, _UsageGraphError.prototype.constructor);
  }
};
function MixedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
MixedNodeData.prototype.clear = function() {
  this.inDegree = 0;
  this.outDegree = 0;
  this.undirectedDegree = 0;
  this.undirectedLoops = 0;
  this.directedLoops = 0;
  this.in = {};
  this.out = {};
  this.undirected = {};
};
function DirectedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
DirectedNodeData.prototype.clear = function() {
  this.inDegree = 0;
  this.outDegree = 0;
  this.directedLoops = 0;
  this.in = {};
  this.out = {};
};
function UndirectedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
UndirectedNodeData.prototype.clear = function() {
  this.undirectedDegree = 0;
  this.undirectedLoops = 0;
  this.undirected = {};
};
function EdgeData(undirected, key, source, target, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.undirected = undirected;
  this.source = source;
  this.target = target;
}
EdgeData.prototype.attach = function() {
  let outKey = "out";
  let inKey = "in";
  if (this.undirected) outKey = inKey = "undirected";
  const source = this.source.key;
  const target = this.target.key;
  this.source[outKey][target] = this;
  if (this.undirected && source === target) return;
  this.target[inKey][source] = this;
};
EdgeData.prototype.attachMulti = function() {
  let outKey = "out";
  let inKey = "in";
  const source = this.source.key;
  const target = this.target.key;
  if (this.undirected) outKey = inKey = "undirected";
  const adj = this.source[outKey];
  const head = adj[target];
  if (typeof head === "undefined") {
    adj[target] = this;
    if (!(this.undirected && source === target)) {
      this.target[inKey][source] = this;
    }
    return;
  }
  head.previous = this;
  this.next = head;
  adj[target] = this;
  this.target[inKey][source] = this;
};
EdgeData.prototype.detach = function() {
  const source = this.source.key;
  const target = this.target.key;
  let outKey = "out";
  let inKey = "in";
  if (this.undirected) outKey = inKey = "undirected";
  delete this.source[outKey][target];
  delete this.target[inKey][source];
};
EdgeData.prototype.detachMulti = function() {
  const source = this.source.key;
  const target = this.target.key;
  let outKey = "out";
  let inKey = "in";
  if (this.undirected) outKey = inKey = "undirected";
  if (this.previous === void 0) {
    if (this.next === void 0) {
      delete this.source[outKey][target];
      delete this.target[inKey][source];
    } else {
      this.next.previous = void 0;
      this.source[outKey][target] = this.next;
      this.target[inKey][source] = this.next;
    }
  } else {
    this.previous.next = this.next;
    if (this.next !== void 0) {
      this.next.previous = this.previous;
    }
  }
};
var NODE = 0;
var SOURCE = 1;
var TARGET = 2;
var OPPOSITE = 3;
function findRelevantNodeData(graph, method, mode, nodeOrEdge, nameOrEdge, add1, add2) {
  let nodeData, edgeData, arg1, arg2;
  nodeOrEdge = "" + nodeOrEdge;
  if (mode === NODE) {
    nodeData = graph._nodes.get(nodeOrEdge);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.${method}: could not find the "${nodeOrEdge}" node in the graph.`
      );
    arg1 = nameOrEdge;
    arg2 = add1;
  } else if (mode === OPPOSITE) {
    nameOrEdge = "" + nameOrEdge;
    edgeData = graph._edges.get(nameOrEdge);
    if (!edgeData)
      throw new NotFoundGraphError(
        `Graph.${method}: could not find the "${nameOrEdge}" edge in the graph.`
      );
    const source = edgeData.source.key;
    const target = edgeData.target.key;
    if (nodeOrEdge === source) {
      nodeData = edgeData.target;
    } else if (nodeOrEdge === target) {
      nodeData = edgeData.source;
    } else {
      throw new NotFoundGraphError(
        `Graph.${method}: the "${nodeOrEdge}" node is not attached to the "${nameOrEdge}" edge (${source}, ${target}).`
      );
    }
    arg1 = add1;
    arg2 = add2;
  } else {
    edgeData = graph._edges.get(nodeOrEdge);
    if (!edgeData)
      throw new NotFoundGraphError(
        `Graph.${method}: could not find the "${nodeOrEdge}" edge in the graph.`
      );
    if (mode === SOURCE) {
      nodeData = edgeData.source;
    } else {
      nodeData = edgeData.target;
    }
    arg1 = nameOrEdge;
    arg2 = add1;
  }
  return [nodeData, arg1, arg2];
}
function attachNodeAttributeGetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    return data.attributes[name];
  };
}
function attachNodeAttributesGetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge) {
    const [data] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge
    );
    return data.attributes;
  };
}
function attachNodeAttributeChecker(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    return data.attributes.hasOwnProperty(name);
  };
}
function attachNodeAttributeSetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1, add2) {
    const [data, name, value] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1,
      add2
    );
    data.attributes[name] = value;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributeUpdater(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1, add2) {
    const [data, name, updater] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1,
      add2
    );
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: updater should be a function.`
      );
    const attributes = data.attributes;
    const value = updater(attributes[name]);
    attributes[name] = value;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributeRemover(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    delete data.attributes[name];
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "remove",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributesReplacer(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, attributes] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided attributes are not a plain object.`
      );
    data.attributes = attributes;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "replace",
      attributes: data.attributes
    });
    return this;
  };
}
function attachNodeAttributesMerger(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, attributes] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided attributes are not a plain object.`
      );
    assign(data.attributes, attributes);
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "merge",
      attributes: data.attributes,
      data: attributes
    });
    return this;
  };
}
function attachNodeAttributesUpdater(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, updater] = findRelevantNodeData(
      this,
      method,
      mode,
      nodeOrEdge,
      nameOrEdge,
      add1
    );
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided updater is not a function.`
      );
    data.attributes = updater(data.attributes);
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "update",
      attributes: data.attributes
    });
    return this;
  };
}
var NODE_ATTRIBUTES_METHODS = [
  {
    name: (element) => `get${element}Attribute`,
    attacher: attachNodeAttributeGetter
  },
  {
    name: (element) => `get${element}Attributes`,
    attacher: attachNodeAttributesGetter
  },
  {
    name: (element) => `has${element}Attribute`,
    attacher: attachNodeAttributeChecker
  },
  {
    name: (element) => `set${element}Attribute`,
    attacher: attachNodeAttributeSetter
  },
  {
    name: (element) => `update${element}Attribute`,
    attacher: attachNodeAttributeUpdater
  },
  {
    name: (element) => `remove${element}Attribute`,
    attacher: attachNodeAttributeRemover
  },
  {
    name: (element) => `replace${element}Attributes`,
    attacher: attachNodeAttributesReplacer
  },
  {
    name: (element) => `merge${element}Attributes`,
    attacher: attachNodeAttributesMerger
  },
  {
    name: (element) => `update${element}Attributes`,
    attacher: attachNodeAttributesUpdater
  }
];
function attachNodeAttributesMethods(Graph2) {
  NODE_ATTRIBUTES_METHODS.forEach(function({ name, attacher }) {
    attacher(Graph2, name("Node"), NODE);
    attacher(Graph2, name("Source"), SOURCE);
    attacher(Graph2, name("Target"), TARGET);
    attacher(Graph2, name("Opposite"), OPPOSITE);
  });
}
function attachEdgeAttributeGetter(Class, method, type2) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    return data.attributes[name];
  };
}
function attachEdgeAttributesGetter(Class, method, type2) {
  Class.prototype[method] = function(element) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 1) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element, target = "" + arguments[1];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    return data.attributes;
  };
}
function attachEdgeAttributeChecker(Class, method, type2) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    return data.attributes.hasOwnProperty(name);
  };
}
function attachEdgeAttributeSetter(Class, method, type2) {
  Class.prototype[method] = function(element, name, value) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 3) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      value = arguments[3];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    data.attributes[name] = value;
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributeUpdater(Class, method, type2) {
  Class.prototype[method] = function(element, name, updater) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 3) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      updater = arguments[3];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: updater should be a function.`
      );
    data.attributes[name] = updater(data.attributes[name]);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributeRemover(Class, method, type2) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    delete data.attributes[name];
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "remove",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributesReplacer(Class, method, type2) {
  Class.prototype[method] = function(element, attributes) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element, target = "" + attributes;
      attributes = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided attributes are not a plain object.`
      );
    data.attributes = attributes;
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "replace",
      attributes: data.attributes
    });
    return this;
  };
}
function attachEdgeAttributesMerger(Class, method, type2) {
  Class.prototype[method] = function(element, attributes) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element, target = "" + attributes;
      attributes = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided attributes are not a plain object.`
      );
    assign(data.attributes, attributes);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "merge",
      attributes: data.attributes,
      data: attributes
    });
    return this;
  };
}
function attachEdgeAttributesUpdater(Class, method, type2) {
  Class.prototype[method] = function(element, updater) {
    let data;
    if (this.type !== "mixed" && type2 !== "mixed" && type2 !== this.type)
      throw new UsageGraphError(
        `Graph.${method}: cannot find this type of edges in your ${this.type} graph.`
      );
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(
          `Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`
        );
      const source = "" + element, target = "" + updater;
      updater = arguments[2];
      data = getMatchingEdge(this, source, target, type2);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`
        );
    } else {
      if (type2 !== "mixed")
        throw new UsageGraphError(
          `Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`
        );
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(
          `Graph.${method}: could not find the "${element}" edge in the graph.`
        );
    }
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        `Graph.${method}: provided updater is not a function.`
      );
    data.attributes = updater(data.attributes);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "update",
      attributes: data.attributes
    });
    return this;
  };
}
var EDGE_ATTRIBUTES_METHODS = [
  {
    name: (element) => `get${element}Attribute`,
    attacher: attachEdgeAttributeGetter
  },
  {
    name: (element) => `get${element}Attributes`,
    attacher: attachEdgeAttributesGetter
  },
  {
    name: (element) => `has${element}Attribute`,
    attacher: attachEdgeAttributeChecker
  },
  {
    name: (element) => `set${element}Attribute`,
    attacher: attachEdgeAttributeSetter
  },
  {
    name: (element) => `update${element}Attribute`,
    attacher: attachEdgeAttributeUpdater
  },
  {
    name: (element) => `remove${element}Attribute`,
    attacher: attachEdgeAttributeRemover
  },
  {
    name: (element) => `replace${element}Attributes`,
    attacher: attachEdgeAttributesReplacer
  },
  {
    name: (element) => `merge${element}Attributes`,
    attacher: attachEdgeAttributesMerger
  },
  {
    name: (element) => `update${element}Attributes`,
    attacher: attachEdgeAttributesUpdater
  }
];
function attachEdgeAttributesMethods(Graph2) {
  EDGE_ATTRIBUTES_METHODS.forEach(function({ name, attacher }) {
    attacher(Graph2, name("Edge"), "mixed");
    attacher(Graph2, name("DirectedEdge"), "directed");
    attacher(Graph2, name("UndirectedEdge"), "undirected");
  });
}
var EDGES_ITERATION = [
  {
    name: "edges",
    type: "mixed"
  },
  {
    name: "inEdges",
    type: "directed",
    direction: "in"
  },
  {
    name: "outEdges",
    type: "directed",
    direction: "out"
  },
  {
    name: "inboundEdges",
    type: "mixed",
    direction: "in"
  },
  {
    name: "outboundEdges",
    type: "mixed",
    direction: "out"
  },
  {
    name: "directedEdges",
    type: "directed"
  },
  {
    name: "undirectedEdges",
    type: "undirected"
  }
];
function forEachSimple(breakable, object, callback, avoid) {
  let shouldBreak = false;
  for (const k in object) {
    if (k === avoid) continue;
    const edgeData = object[k];
    shouldBreak = callback(
      edgeData.key,
      edgeData.attributes,
      edgeData.source.key,
      edgeData.target.key,
      edgeData.source.attributes,
      edgeData.target.attributes,
      edgeData.undirected
    );
    if (breakable && shouldBreak) return edgeData.key;
  }
  return;
}
function forEachMulti(breakable, object, callback, avoid) {
  let edgeData, source, target;
  let shouldBreak = false;
  for (const k in object) {
    if (k === avoid) continue;
    edgeData = object[k];
    do {
      source = edgeData.source;
      target = edgeData.target;
      shouldBreak = callback(
        edgeData.key,
        edgeData.attributes,
        source.key,
        target.key,
        source.attributes,
        target.attributes,
        edgeData.undirected
      );
      if (breakable && shouldBreak) return edgeData.key;
      edgeData = edgeData.next;
    } while (edgeData !== void 0);
  }
  return;
}
function createIterator(object, avoid) {
  const keys = Object.keys(object);
  const l = keys.length;
  let edgeData;
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      do {
        if (!edgeData) {
          if (i >= l) return { done: true };
          const k = keys[i++];
          if (k === avoid) {
            edgeData = void 0;
            continue;
          }
          edgeData = object[k];
        } else {
          edgeData = edgeData.next;
        }
      } while (!edgeData);
      return {
        done: false,
        value: {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        }
      };
    }
  };
}
function forEachForKeySimple(breakable, object, k, callback) {
  const edgeData = object[k];
  if (!edgeData) return;
  const sourceData = edgeData.source;
  const targetData = edgeData.target;
  if (callback(
    edgeData.key,
    edgeData.attributes,
    sourceData.key,
    targetData.key,
    sourceData.attributes,
    targetData.attributes,
    edgeData.undirected
  ) && breakable)
    return edgeData.key;
}
function forEachForKeyMulti(breakable, object, k, callback) {
  let edgeData = object[k];
  if (!edgeData) return;
  let shouldBreak = false;
  do {
    shouldBreak = callback(
      edgeData.key,
      edgeData.attributes,
      edgeData.source.key,
      edgeData.target.key,
      edgeData.source.attributes,
      edgeData.target.attributes,
      edgeData.undirected
    );
    if (breakable && shouldBreak) return edgeData.key;
    edgeData = edgeData.next;
  } while (edgeData !== void 0);
  return;
}
function createIteratorForKey(object, k) {
  let edgeData = object[k];
  if (edgeData.next !== void 0) {
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        if (!edgeData) return { done: true };
        const value = {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        };
        edgeData = edgeData.next;
        return {
          done: false,
          value
        };
      }
    };
  }
  let done = false;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      if (done === true) return { done: true };
      done = true;
      return {
        done: false,
        value: {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        }
      };
    }
  };
}
function createEdgeArray(graph, type2) {
  if (graph.size === 0) return [];
  if (type2 === "mixed" || type2 === graph.type) {
    return Array.from(graph._edges.keys());
  }
  const size = type2 === "undirected" ? graph.undirectedSize : graph.directedSize;
  const list = new Array(size), mask = type2 === "undirected";
  const iterator = graph._edges.values();
  let i = 0;
  let step, data;
  while (step = iterator.next(), step.done !== true) {
    data = step.value;
    if (data.undirected === mask) list[i++] = data.key;
  }
  return list;
}
function forEachEdge(breakable, graph, type2, callback) {
  if (graph.size === 0) return;
  const shouldFilter = type2 !== "mixed" && type2 !== graph.type;
  const mask = type2 === "undirected";
  let step, data;
  let shouldBreak = false;
  const iterator = graph._edges.values();
  while (step = iterator.next(), step.done !== true) {
    data = step.value;
    if (shouldFilter && data.undirected !== mask) continue;
    const { key, attributes, source, target } = data;
    shouldBreak = callback(
      key,
      attributes,
      source.key,
      target.key,
      source.attributes,
      target.attributes,
      data.undirected
    );
    if (breakable && shouldBreak) return key;
  }
  return;
}
function createEdgeIterator(graph, type2) {
  if (graph.size === 0) return emptyIterator();
  const shouldFilter = type2 !== "mixed" && type2 !== graph.type;
  const mask = type2 === "undirected";
  const iterator = graph._edges.values();
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let step, data;
      while (true) {
        step = iterator.next();
        if (step.done) return step;
        data = step.value;
        if (shouldFilter && data.undirected !== mask) continue;
        break;
      }
      const value = {
        edge: data.key,
        attributes: data.attributes,
        source: data.source.key,
        target: data.target.key,
        sourceAttributes: data.source.attributes,
        targetAttributes: data.target.attributes,
        undirected: data.undirected
      };
      return { value, done: false };
    }
  };
}
function forEachEdgeForNode(breakable, multi, type2, direction, nodeData, callback) {
  const fn = multi ? forEachMulti : forEachSimple;
  let found;
  if (type2 !== "undirected") {
    if (direction !== "out") {
      found = fn(breakable, nodeData.in, callback);
      if (breakable && found) return found;
    }
    if (direction !== "in") {
      found = fn(
        breakable,
        nodeData.out,
        callback,
        !direction ? nodeData.key : void 0
      );
      if (breakable && found) return found;
    }
  }
  if (type2 !== "directed") {
    found = fn(breakable, nodeData.undirected, callback);
    if (breakable && found) return found;
  }
  return;
}
function createEdgeArrayForNode(multi, type2, direction, nodeData) {
  const edges = [];
  forEachEdgeForNode(false, multi, type2, direction, nodeData, function(key) {
    edges.push(key);
  });
  return edges;
}
function createEdgeIteratorForNode(type2, direction, nodeData) {
  let iterator = emptyIterator();
  if (type2 !== "undirected") {
    if (direction !== "out" && typeof nodeData.in !== "undefined")
      iterator = chain(iterator, createIterator(nodeData.in));
    if (direction !== "in" && typeof nodeData.out !== "undefined")
      iterator = chain(
        iterator,
        createIterator(nodeData.out, !direction ? nodeData.key : void 0)
      );
  }
  if (type2 !== "directed" && typeof nodeData.undirected !== "undefined") {
    iterator = chain(iterator, createIterator(nodeData.undirected));
  }
  return iterator;
}
function forEachEdgeForPath(breakable, type2, multi, direction, sourceData, target, callback) {
  const fn = multi ? forEachForKeyMulti : forEachForKeySimple;
  let found;
  if (type2 !== "undirected") {
    if (typeof sourceData.in !== "undefined" && direction !== "out") {
      found = fn(breakable, sourceData.in, target, callback);
      if (breakable && found) return found;
    }
    if (typeof sourceData.out !== "undefined" && direction !== "in" && (direction || sourceData.key !== target)) {
      found = fn(breakable, sourceData.out, target, callback);
      if (breakable && found) return found;
    }
  }
  if (type2 !== "directed") {
    if (typeof sourceData.undirected !== "undefined") {
      found = fn(breakable, sourceData.undirected, target, callback);
      if (breakable && found) return found;
    }
  }
  return;
}
function createEdgeArrayForPath(type2, multi, direction, sourceData, target) {
  const edges = [];
  forEachEdgeForPath(
    false,
    type2,
    multi,
    direction,
    sourceData,
    target,
    function(key) {
      edges.push(key);
    }
  );
  return edges;
}
function createEdgeIteratorForPath(type2, direction, sourceData, target) {
  let iterator = emptyIterator();
  if (type2 !== "undirected") {
    if (typeof sourceData.in !== "undefined" && direction !== "out" && target in sourceData.in)
      iterator = chain(iterator, createIteratorForKey(sourceData.in, target));
    if (typeof sourceData.out !== "undefined" && direction !== "in" && target in sourceData.out && (direction || sourceData.key !== target))
      iterator = chain(iterator, createIteratorForKey(sourceData.out, target));
  }
  if (type2 !== "directed") {
    if (typeof sourceData.undirected !== "undefined" && target in sourceData.undirected)
      iterator = chain(
        iterator,
        createIteratorForKey(sourceData.undirected, target)
      );
  }
  return iterator;
}
function attachEdgeArrayCreator(Class, description) {
  const { name, type: type2, direction } = description;
  Class.prototype[name] = function(source, target) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type)
      return [];
    if (!arguments.length) return createEdgeArray(this, type2);
    if (arguments.length === 1) {
      source = "" + source;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(
          `Graph.${name}: could not find the "${source}" node in the graph.`
        );
      return createEdgeArrayForNode(
        this.multi,
        type2 === "mixed" ? this.type : type2,
        direction,
        nodeData
      );
    }
    if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(
          `Graph.${name}:  could not find the "${source}" source node in the graph.`
        );
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(
          `Graph.${name}:  could not find the "${target}" target node in the graph.`
        );
      return createEdgeArrayForPath(
        type2,
        this.multi,
        direction,
        sourceData,
        target
      );
    }
    throw new InvalidArgumentsGraphError(
      `Graph.${name}: too many arguments (expecting 0, 1 or 2 and got ${arguments.length}).`
    );
  };
}
function attachForEachEdge(Class, description) {
  const { name, type: type2, direction } = description;
  const forEachName = "forEach" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[forEachName] = function(source, target, callback) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type) return;
    if (arguments.length === 1) {
      callback = source;
      return forEachEdge(false, this, type2, callback);
    }
    if (arguments.length === 2) {
      source = "" + source;
      callback = target;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(
          `Graph.${forEachName}: could not find the "${source}" node in the graph.`
        );
      return forEachEdgeForNode(
        false,
        this.multi,
        type2 === "mixed" ? this.type : type2,
        direction,
        nodeData,
        callback
      );
    }
    if (arguments.length === 3) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(
          `Graph.${forEachName}:  could not find the "${source}" source node in the graph.`
        );
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(
          `Graph.${forEachName}:  could not find the "${target}" target node in the graph.`
        );
      return forEachEdgeForPath(
        false,
        type2,
        this.multi,
        direction,
        sourceData,
        target,
        callback
      );
    }
    throw new InvalidArgumentsGraphError(
      `Graph.${forEachName}: too many arguments (expecting 1, 2 or 3 and got ${arguments.length}).`
    );
  };
  const mapName = "map" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[mapName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    let result;
    if (args.length === 0) {
      let length = 0;
      if (type2 !== "directed") length += this.undirectedSize;
      if (type2 !== "undirected") length += this.directedSize;
      result = new Array(length);
      let i = 0;
      args.push((e, ea, s, t, sa, ta, u) => {
        result[i++] = callback(e, ea, s, t, sa, ta, u);
      });
    } else {
      result = [];
      args.push((e, ea, s, t, sa, ta, u) => {
        result.push(callback(e, ea, s, t, sa, ta, u));
      });
    }
    this[forEachName].apply(this, args);
    return result;
  };
  const filterName = "filter" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[filterName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    const result = [];
    args.push((e, ea, s, t, sa, ta, u) => {
      if (callback(e, ea, s, t, sa, ta, u)) result.push(e);
    });
    this[forEachName].apply(this, args);
    return result;
  };
  const reduceName = "reduce" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[reduceName] = function() {
    let args = Array.prototype.slice.call(arguments);
    if (args.length < 2 || args.length > 4) {
      throw new InvalidArgumentsGraphError(
        `Graph.${reduceName}: invalid number of arguments (expecting 2, 3 or 4 and got ${args.length}).`
      );
    }
    if (typeof args[args.length - 1] === "function" && typeof args[args.length - 2] !== "function") {
      throw new InvalidArgumentsGraphError(
        `Graph.${reduceName}: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array.`
      );
    }
    let callback;
    let initialValue;
    if (args.length === 2) {
      callback = args[0];
      initialValue = args[1];
      args = [];
    } else if (args.length === 3) {
      callback = args[1];
      initialValue = args[2];
      args = [args[0]];
    } else if (args.length === 4) {
      callback = args[2];
      initialValue = args[3];
      args = [args[0], args[1]];
    }
    let accumulator = initialValue;
    args.push((e, ea, s, t, sa, ta, u) => {
      accumulator = callback(accumulator, e, ea, s, t, sa, ta, u);
    });
    this[forEachName].apply(this, args);
    return accumulator;
  };
}
function attachFindEdge(Class, description) {
  const { name, type: type2, direction } = description;
  const findEdgeName = "find" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[findEdgeName] = function(source, target, callback) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type)
      return false;
    if (arguments.length === 1) {
      callback = source;
      return forEachEdge(true, this, type2, callback);
    }
    if (arguments.length === 2) {
      source = "" + source;
      callback = target;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(
          `Graph.${findEdgeName}: could not find the "${source}" node in the graph.`
        );
      return forEachEdgeForNode(
        true,
        this.multi,
        type2 === "mixed" ? this.type : type2,
        direction,
        nodeData,
        callback
      );
    }
    if (arguments.length === 3) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(
          `Graph.${findEdgeName}:  could not find the "${source}" source node in the graph.`
        );
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(
          `Graph.${findEdgeName}:  could not find the "${target}" target node in the graph.`
        );
      return forEachEdgeForPath(
        true,
        type2,
        this.multi,
        direction,
        sourceData,
        target,
        callback
      );
    }
    throw new InvalidArgumentsGraphError(
      `Graph.${findEdgeName}: too many arguments (expecting 1, 2 or 3 and got ${arguments.length}).`
    );
  };
  const someName = "some" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[someName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    args.push((e, ea, s, t, sa, ta, u) => {
      return callback(e, ea, s, t, sa, ta, u);
    });
    const found = this[findEdgeName].apply(this, args);
    if (found) return true;
    return false;
  };
  const everyName = "every" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[everyName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    args.push((e, ea, s, t, sa, ta, u) => {
      return !callback(e, ea, s, t, sa, ta, u);
    });
    const found = this[findEdgeName].apply(this, args);
    if (found) return false;
    return true;
  };
}
function attachEdgeIteratorCreator(Class, description) {
  const { name: originalName, type: type2, direction } = description;
  const name = originalName.slice(0, -1) + "Entries";
  Class.prototype[name] = function(source, target) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type)
      return emptyIterator();
    if (!arguments.length) return createEdgeIterator(this, type2);
    if (arguments.length === 1) {
      source = "" + source;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(
          `Graph.${name}: could not find the "${source}" node in the graph.`
        );
      return createEdgeIteratorForNode(type2, direction, sourceData);
    }
    if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(
          `Graph.${name}:  could not find the "${source}" source node in the graph.`
        );
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(
          `Graph.${name}:  could not find the "${target}" target node in the graph.`
        );
      return createEdgeIteratorForPath(type2, direction, sourceData, target);
    }
    throw new InvalidArgumentsGraphError(
      `Graph.${name}: too many arguments (expecting 0, 1 or 2 and got ${arguments.length}).`
    );
  };
}
function attachEdgeIterationMethods(Graph2) {
  EDGES_ITERATION.forEach((description) => {
    attachEdgeArrayCreator(Graph2, description);
    attachForEachEdge(Graph2, description);
    attachFindEdge(Graph2, description);
    attachEdgeIteratorCreator(Graph2, description);
  });
}
var NEIGHBORS_ITERATION = [
  {
    name: "neighbors",
    type: "mixed"
  },
  {
    name: "inNeighbors",
    type: "directed",
    direction: "in"
  },
  {
    name: "outNeighbors",
    type: "directed",
    direction: "out"
  },
  {
    name: "inboundNeighbors",
    type: "mixed",
    direction: "in"
  },
  {
    name: "outboundNeighbors",
    type: "mixed",
    direction: "out"
  },
  {
    name: "directedNeighbors",
    type: "directed"
  },
  {
    name: "undirectedNeighbors",
    type: "undirected"
  }
];
function CompositeSetWrapper() {
  this.A = null;
  this.B = null;
}
CompositeSetWrapper.prototype.wrap = function(set2) {
  if (this.A === null) this.A = set2;
  else if (this.B === null) this.B = set2;
};
CompositeSetWrapper.prototype.has = function(key) {
  if (this.A !== null && key in this.A) return true;
  if (this.B !== null && key in this.B) return true;
  return false;
};
function forEachInObjectOnce(breakable, visited, nodeData, object, callback) {
  for (const k in object) {
    const edgeData = object[k];
    const sourceData = edgeData.source;
    const targetData = edgeData.target;
    const neighborData = sourceData === nodeData ? targetData : sourceData;
    if (visited && visited.has(neighborData.key)) continue;
    const shouldBreak = callback(neighborData.key, neighborData.attributes);
    if (breakable && shouldBreak) return neighborData.key;
  }
  return;
}
function forEachNeighbor(breakable, type2, direction, nodeData, callback) {
  if (type2 !== "mixed") {
    if (type2 === "undirected")
      return forEachInObjectOnce(
        breakable,
        null,
        nodeData,
        nodeData.undirected,
        callback
      );
    if (typeof direction === "string")
      return forEachInObjectOnce(
        breakable,
        null,
        nodeData,
        nodeData[direction],
        callback
      );
  }
  const visited = new CompositeSetWrapper();
  let found;
  if (type2 !== "undirected") {
    if (direction !== "out") {
      found = forEachInObjectOnce(
        breakable,
        null,
        nodeData,
        nodeData.in,
        callback
      );
      if (breakable && found) return found;
      visited.wrap(nodeData.in);
    }
    if (direction !== "in") {
      found = forEachInObjectOnce(
        breakable,
        visited,
        nodeData,
        nodeData.out,
        callback
      );
      if (breakable && found) return found;
      visited.wrap(nodeData.out);
    }
  }
  if (type2 !== "directed") {
    found = forEachInObjectOnce(
      breakable,
      visited,
      nodeData,
      nodeData.undirected,
      callback
    );
    if (breakable && found) return found;
  }
  return;
}
function createNeighborArrayForNode(type2, direction, nodeData) {
  if (type2 !== "mixed") {
    if (type2 === "undirected") return Object.keys(nodeData.undirected);
    if (typeof direction === "string") return Object.keys(nodeData[direction]);
  }
  const neighbors = [];
  forEachNeighbor(false, type2, direction, nodeData, function(key) {
    neighbors.push(key);
  });
  return neighbors;
}
function createDedupedObjectIterator(visited, nodeData, object) {
  const keys = Object.keys(object);
  const l = keys.length;
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let neighborData = null;
      do {
        if (i >= l) {
          if (visited) visited.wrap(object);
          return { done: true };
        }
        const edgeData = object[keys[i++]];
        const sourceData = edgeData.source;
        const targetData = edgeData.target;
        neighborData = sourceData === nodeData ? targetData : sourceData;
        if (visited && visited.has(neighborData.key)) {
          neighborData = null;
          continue;
        }
      } while (neighborData === null);
      return {
        done: false,
        value: { neighbor: neighborData.key, attributes: neighborData.attributes }
      };
    }
  };
}
function createNeighborIterator(type2, direction, nodeData) {
  if (type2 !== "mixed") {
    if (type2 === "undirected")
      return createDedupedObjectIterator(null, nodeData, nodeData.undirected);
    if (typeof direction === "string")
      return createDedupedObjectIterator(null, nodeData, nodeData[direction]);
  }
  let iterator = emptyIterator();
  const visited = new CompositeSetWrapper();
  if (type2 !== "undirected") {
    if (direction !== "out") {
      iterator = chain(
        iterator,
        createDedupedObjectIterator(visited, nodeData, nodeData.in)
      );
    }
    if (direction !== "in") {
      iterator = chain(
        iterator,
        createDedupedObjectIterator(visited, nodeData, nodeData.out)
      );
    }
  }
  if (type2 !== "directed") {
    iterator = chain(
      iterator,
      createDedupedObjectIterator(visited, nodeData, nodeData.undirected)
    );
  }
  return iterator;
}
function attachNeighborArrayCreator(Class, description) {
  const { name, type: type2, direction } = description;
  Class.prototype[name] = function(node) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type)
      return [];
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(
        `Graph.${name}: could not find the "${node}" node in the graph.`
      );
    return createNeighborArrayForNode(
      type2 === "mixed" ? this.type : type2,
      direction,
      nodeData
    );
  };
}
function attachForEachNeighbor(Class, description) {
  const { name, type: type2, direction } = description;
  const forEachName = "forEach" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[forEachName] = function(node, callback) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type) return;
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(
        `Graph.${forEachName}: could not find the "${node}" node in the graph.`
      );
    forEachNeighbor(
      false,
      type2 === "mixed" ? this.type : type2,
      direction,
      nodeData,
      callback
    );
  };
  const mapName = "map" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[mapName] = function(node, callback) {
    const result = [];
    this[forEachName](node, (n, a) => {
      result.push(callback(n, a));
    });
    return result;
  };
  const filterName = "filter" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[filterName] = function(node, callback) {
    const result = [];
    this[forEachName](node, (n, a) => {
      if (callback(n, a)) result.push(n);
    });
    return result;
  };
  const reduceName = "reduce" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[reduceName] = function(node, callback, initialValue) {
    if (arguments.length < 3)
      throw new InvalidArgumentsGraphError(
        `Graph.${reduceName}: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array.`
      );
    let accumulator = initialValue;
    this[forEachName](node, (n, a) => {
      accumulator = callback(accumulator, n, a);
    });
    return accumulator;
  };
}
function attachFindNeighbor(Class, description) {
  const { name, type: type2, direction } = description;
  const capitalizedSingular = name[0].toUpperCase() + name.slice(1, -1);
  const findName = "find" + capitalizedSingular;
  Class.prototype[findName] = function(node, callback) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type) return;
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(
        `Graph.${findName}: could not find the "${node}" node in the graph.`
      );
    return forEachNeighbor(
      true,
      type2 === "mixed" ? this.type : type2,
      direction,
      nodeData,
      callback
    );
  };
  const someName = "some" + capitalizedSingular;
  Class.prototype[someName] = function(node, callback) {
    const found = this[findName](node, callback);
    if (found) return true;
    return false;
  };
  const everyName = "every" + capitalizedSingular;
  Class.prototype[everyName] = function(node, callback) {
    const found = this[findName](node, (n, a) => {
      return !callback(n, a);
    });
    if (found) return false;
    return true;
  };
}
function attachNeighborIteratorCreator(Class, description) {
  const { name, type: type2, direction } = description;
  const iteratorName = name.slice(0, -1) + "Entries";
  Class.prototype[iteratorName] = function(node) {
    if (type2 !== "mixed" && this.type !== "mixed" && type2 !== this.type)
      return emptyIterator();
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(
        `Graph.${iteratorName}: could not find the "${node}" node in the graph.`
      );
    return createNeighborIterator(
      type2 === "mixed" ? this.type : type2,
      direction,
      nodeData
    );
  };
}
function attachNeighborIterationMethods(Graph2) {
  NEIGHBORS_ITERATION.forEach((description) => {
    attachNeighborArrayCreator(Graph2, description);
    attachForEachNeighbor(Graph2, description);
    attachFindNeighbor(Graph2, description);
    attachNeighborIteratorCreator(Graph2, description);
  });
}
function forEachAdjacency(breakable, assymetric, disconnectedNodes, graph, callback) {
  const iterator = graph._nodes.values();
  const type2 = graph.type;
  let step, sourceData, neighbor, adj, edgeData, targetData, shouldBreak;
  while (step = iterator.next(), step.done !== true) {
    let hasEdges = false;
    sourceData = step.value;
    if (type2 !== "undirected") {
      adj = sourceData.out;
      for (neighbor in adj) {
        edgeData = adj[neighbor];
        do {
          targetData = edgeData.target;
          hasEdges = true;
          shouldBreak = callback(
            sourceData.key,
            targetData.key,
            sourceData.attributes,
            targetData.attributes,
            edgeData.key,
            edgeData.attributes,
            edgeData.undirected
          );
          if (breakable && shouldBreak) return edgeData;
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (type2 !== "directed") {
      adj = sourceData.undirected;
      for (neighbor in adj) {
        if (assymetric && sourceData.key > neighbor) continue;
        edgeData = adj[neighbor];
        do {
          targetData = edgeData.target;
          if (targetData.key !== neighbor) targetData = edgeData.source;
          hasEdges = true;
          shouldBreak = callback(
            sourceData.key,
            targetData.key,
            sourceData.attributes,
            targetData.attributes,
            edgeData.key,
            edgeData.attributes,
            edgeData.undirected
          );
          if (breakable && shouldBreak) return edgeData;
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (disconnectedNodes && !hasEdges) {
      shouldBreak = callback(
        sourceData.key,
        null,
        sourceData.attributes,
        null,
        null,
        null,
        null
      );
      if (breakable && shouldBreak) return null;
    }
  }
  return;
}
function serializeNode(key, data) {
  const serialized = { key };
  if (!isEmpty(data.attributes))
    serialized.attributes = assign({}, data.attributes);
  return serialized;
}
function serializeEdge(type2, key, data) {
  const serialized = {
    key,
    source: data.source.key,
    target: data.target.key
  };
  if (!isEmpty(data.attributes))
    serialized.attributes = assign({}, data.attributes);
  if (type2 === "mixed" && data.undirected) serialized.undirected = true;
  return serialized;
}
function validateSerializedNode(value) {
  if (!isPlainObject(value))
    throw new InvalidArgumentsGraphError(
      'Graph.import: invalid serialized node. A serialized node should be a plain object with at least a "key" property.'
    );
  if (!("key" in value))
    throw new InvalidArgumentsGraphError(
      "Graph.import: serialized node is missing its key."
    );
  if ("attributes" in value && (!isPlainObject(value.attributes) || value.attributes === null))
    throw new InvalidArgumentsGraphError(
      "Graph.import: invalid attributes. Attributes should be a plain object, null or omitted."
    );
}
function validateSerializedEdge(value) {
  if (!isPlainObject(value))
    throw new InvalidArgumentsGraphError(
      'Graph.import: invalid serialized edge. A serialized edge should be a plain object with at least a "source" & "target" property.'
    );
  if (!("source" in value))
    throw new InvalidArgumentsGraphError(
      "Graph.import: serialized edge is missing its source."
    );
  if (!("target" in value))
    throw new InvalidArgumentsGraphError(
      "Graph.import: serialized edge is missing its target."
    );
  if ("attributes" in value && (!isPlainObject(value.attributes) || value.attributes === null))
    throw new InvalidArgumentsGraphError(
      "Graph.import: invalid attributes. Attributes should be a plain object, null or omitted."
    );
  if ("undirected" in value && typeof value.undirected !== "boolean")
    throw new InvalidArgumentsGraphError(
      "Graph.import: invalid undirectedness information. Undirected should be boolean or omitted."
    );
}
var INSTANCE_ID = incrementalIdStartingFromRandomByte();
var TYPES = /* @__PURE__ */ new Set(["directed", "undirected", "mixed"]);
var EMITTER_PROPS = /* @__PURE__ */ new Set([
  "domain",
  "_events",
  "_eventsCount",
  "_maxListeners"
]);
var EDGE_ADD_METHODS = [
  {
    name: (verb) => `${verb}Edge`,
    generateKey: true
  },
  {
    name: (verb) => `${verb}DirectedEdge`,
    generateKey: true,
    type: "directed"
  },
  {
    name: (verb) => `${verb}UndirectedEdge`,
    generateKey: true,
    type: "undirected"
  },
  {
    name: (verb) => `${verb}EdgeWithKey`
  },
  {
    name: (verb) => `${verb}DirectedEdgeWithKey`,
    type: "directed"
  },
  {
    name: (verb) => `${verb}UndirectedEdgeWithKey`,
    type: "undirected"
  }
];
var DEFAULTS = {
  allowSelfLoops: true,
  multi: false,
  type: "mixed"
};
function addNode(graph, node, attributes) {
  if (attributes && !isPlainObject(attributes))
    throw new InvalidArgumentsGraphError(
      `Graph.addNode: invalid attributes. Expecting an object but got "${attributes}"`
    );
  node = "" + node;
  attributes = attributes || {};
  if (graph._nodes.has(node))
    throw new UsageGraphError(
      `Graph.addNode: the "${node}" node already exist in the graph.`
    );
  const data = new graph.NodeDataClass(node, attributes);
  graph._nodes.set(node, data);
  graph.emit("nodeAdded", {
    key: node,
    attributes
  });
  return data;
}
function unsafeAddNode(graph, node, attributes) {
  const data = new graph.NodeDataClass(node, attributes);
  graph._nodes.set(node, data);
  graph.emit("nodeAdded", {
    key: node,
    attributes
  });
  return data;
}
function addEdge(graph, name, mustGenerateKey, undirected, edge, source, target, attributes) {
  if (!undirected && graph.type === "undirected")
    throw new UsageGraphError(
      `Graph.${name}: you cannot add a directed edge to an undirected graph. Use the #.addEdge or #.addUndirectedEdge instead.`
    );
  if (undirected && graph.type === "directed")
    throw new UsageGraphError(
      `Graph.${name}: you cannot add an undirected edge to a directed graph. Use the #.addEdge or #.addDirectedEdge instead.`
    );
  if (attributes && !isPlainObject(attributes))
    throw new InvalidArgumentsGraphError(
      `Graph.${name}: invalid attributes. Expecting an object but got "${attributes}"`
    );
  source = "" + source;
  target = "" + target;
  attributes = attributes || {};
  if (!graph.allowSelfLoops && source === target)
    throw new UsageGraphError(
      `Graph.${name}: source & target are the same ("${source}"), thus creating a loop explicitly forbidden by this graph 'allowSelfLoops' option set to false.`
    );
  const sourceData = graph._nodes.get(source), targetData = graph._nodes.get(target);
  if (!sourceData)
    throw new NotFoundGraphError(
      `Graph.${name}: source node "${source}" not found.`
    );
  if (!targetData)
    throw new NotFoundGraphError(
      `Graph.${name}: target node "${target}" not found.`
    );
  const eventData = {
    key: null,
    undirected,
    source,
    target,
    attributes
  };
  if (mustGenerateKey) {
    edge = graph._edgeKeyGenerator();
  } else {
    edge = "" + edge;
    if (graph._edges.has(edge))
      throw new UsageGraphError(
        `Graph.${name}: the "${edge}" edge already exists in the graph.`
      );
  }
  if (!graph.multi && (undirected ? typeof sourceData.undirected[target] !== "undefined" : typeof sourceData.out[target] !== "undefined")) {
    throw new UsageGraphError(
      `Graph.${name}: an edge linking "${source}" to "${target}" already exists. If you really want to add multiple edges linking those nodes, you should create a multi graph by using the 'multi' option.`
    );
  }
  const edgeData = new EdgeData(
    undirected,
    edge,
    sourceData,
    targetData,
    attributes
  );
  graph._edges.set(edge, edgeData);
  const isSelfLoop = source === target;
  if (undirected) {
    sourceData.undirectedDegree++;
    targetData.undirectedDegree++;
    if (isSelfLoop) {
      sourceData.undirectedLoops++;
      graph._undirectedSelfLoopCount++;
    }
  } else {
    sourceData.outDegree++;
    targetData.inDegree++;
    if (isSelfLoop) {
      sourceData.directedLoops++;
      graph._directedSelfLoopCount++;
    }
  }
  if (graph.multi) edgeData.attachMulti();
  else edgeData.attach();
  if (undirected) graph._undirectedSize++;
  else graph._directedSize++;
  eventData.key = edge;
  graph.emit("edgeAdded", eventData);
  return edge;
}
function mergeEdge(graph, name, mustGenerateKey, undirected, edge, source, target, attributes, asUpdater) {
  if (!undirected && graph.type === "undirected")
    throw new UsageGraphError(
      `Graph.${name}: you cannot merge/update a directed edge to an undirected graph. Use the #.mergeEdge/#.updateEdge or #.addUndirectedEdge instead.`
    );
  if (undirected && graph.type === "directed")
    throw new UsageGraphError(
      `Graph.${name}: you cannot merge/update an undirected edge to a directed graph. Use the #.mergeEdge/#.updateEdge or #.addDirectedEdge instead.`
    );
  if (attributes) {
    if (asUpdater) {
      if (typeof attributes !== "function")
        throw new InvalidArgumentsGraphError(
          `Graph.${name}: invalid updater function. Expecting a function but got "${attributes}"`
        );
    } else {
      if (!isPlainObject(attributes))
        throw new InvalidArgumentsGraphError(
          `Graph.${name}: invalid attributes. Expecting an object but got "${attributes}"`
        );
    }
  }
  source = "" + source;
  target = "" + target;
  let updater;
  if (asUpdater) {
    updater = attributes;
    attributes = void 0;
  }
  if (!graph.allowSelfLoops && source === target)
    throw new UsageGraphError(
      `Graph.${name}: source & target are the same ("${source}"), thus creating a loop explicitly forbidden by this graph 'allowSelfLoops' option set to false.`
    );
  let sourceData = graph._nodes.get(source);
  let targetData = graph._nodes.get(target);
  let edgeData;
  let alreadyExistingEdgeData;
  if (!mustGenerateKey) {
    edgeData = graph._edges.get(edge);
    if (edgeData) {
      if (edgeData.source.key !== source || edgeData.target.key !== target) {
        if (!undirected || edgeData.source.key !== target || edgeData.target.key !== source) {
          throw new UsageGraphError(
            `Graph.${name}: inconsistency detected when attempting to merge the "${edge}" edge with "${source}" source & "${target}" target vs. ("${edgeData.source.key}", "${edgeData.target.key}").`
          );
        }
      }
      alreadyExistingEdgeData = edgeData;
    }
  }
  if (!alreadyExistingEdgeData && !graph.multi && sourceData) {
    alreadyExistingEdgeData = undirected ? sourceData.undirected[target] : sourceData.out[target];
  }
  if (alreadyExistingEdgeData) {
    const info = [alreadyExistingEdgeData.key, false, false, false];
    if (asUpdater ? !updater : !attributes) return info;
    if (asUpdater) {
      const oldAttributes = alreadyExistingEdgeData.attributes;
      alreadyExistingEdgeData.attributes = updater(oldAttributes);
      graph.emit("edgeAttributesUpdated", {
        type: "replace",
        key: alreadyExistingEdgeData.key,
        attributes: alreadyExistingEdgeData.attributes
      });
    } else {
      assign(alreadyExistingEdgeData.attributes, attributes);
      graph.emit("edgeAttributesUpdated", {
        type: "merge",
        key: alreadyExistingEdgeData.key,
        attributes: alreadyExistingEdgeData.attributes,
        data: attributes
      });
    }
    return info;
  }
  attributes = attributes || {};
  if (asUpdater && updater) attributes = updater(attributes);
  const eventData = {
    key: null,
    undirected,
    source,
    target,
    attributes
  };
  if (mustGenerateKey) {
    edge = graph._edgeKeyGenerator();
  } else {
    edge = "" + edge;
    if (graph._edges.has(edge))
      throw new UsageGraphError(
        `Graph.${name}: the "${edge}" edge already exists in the graph.`
      );
  }
  let sourceWasAdded = false;
  let targetWasAdded = false;
  if (!sourceData) {
    sourceData = unsafeAddNode(graph, source, {});
    sourceWasAdded = true;
    if (source === target) {
      targetData = sourceData;
      targetWasAdded = true;
    }
  }
  if (!targetData) {
    targetData = unsafeAddNode(graph, target, {});
    targetWasAdded = true;
  }
  edgeData = new EdgeData(undirected, edge, sourceData, targetData, attributes);
  graph._edges.set(edge, edgeData);
  const isSelfLoop = source === target;
  if (undirected) {
    sourceData.undirectedDegree++;
    targetData.undirectedDegree++;
    if (isSelfLoop) {
      sourceData.undirectedLoops++;
      graph._undirectedSelfLoopCount++;
    }
  } else {
    sourceData.outDegree++;
    targetData.inDegree++;
    if (isSelfLoop) {
      sourceData.directedLoops++;
      graph._directedSelfLoopCount++;
    }
  }
  if (graph.multi) edgeData.attachMulti();
  else edgeData.attach();
  if (undirected) graph._undirectedSize++;
  else graph._directedSize++;
  eventData.key = edge;
  graph.emit("edgeAdded", eventData);
  return [edge, true, sourceWasAdded, targetWasAdded];
}
function dropEdgeFromData(graph, edgeData) {
  graph._edges.delete(edgeData.key);
  const { source: sourceData, target: targetData, attributes } = edgeData;
  const undirected = edgeData.undirected;
  const isSelfLoop = sourceData === targetData;
  if (undirected) {
    sourceData.undirectedDegree--;
    targetData.undirectedDegree--;
    if (isSelfLoop) {
      sourceData.undirectedLoops--;
      graph._undirectedSelfLoopCount--;
    }
  } else {
    sourceData.outDegree--;
    targetData.inDegree--;
    if (isSelfLoop) {
      sourceData.directedLoops--;
      graph._directedSelfLoopCount--;
    }
  }
  if (graph.multi) edgeData.detachMulti();
  else edgeData.detach();
  if (undirected) graph._undirectedSize--;
  else graph._directedSize--;
  graph.emit("edgeDropped", {
    key: edgeData.key,
    attributes,
    source: sourceData.key,
    target: targetData.key,
    undirected
  });
}
var Graph = class _Graph extends import_events.EventEmitter {
  constructor(options) {
    super();
    options = assign({}, DEFAULTS, options);
    if (typeof options.multi !== "boolean")
      throw new InvalidArgumentsGraphError(
        `Graph.constructor: invalid 'multi' option. Expecting a boolean but got "${options.multi}".`
      );
    if (!TYPES.has(options.type))
      throw new InvalidArgumentsGraphError(
        `Graph.constructor: invalid 'type' option. Should be one of "mixed", "directed" or "undirected" but got "${options.type}".`
      );
    if (typeof options.allowSelfLoops !== "boolean")
      throw new InvalidArgumentsGraphError(
        `Graph.constructor: invalid 'allowSelfLoops' option. Expecting a boolean but got "${options.allowSelfLoops}".`
      );
    const NodeDataClass = options.type === "mixed" ? MixedNodeData : options.type === "directed" ? DirectedNodeData : UndirectedNodeData;
    privateProperty(this, "NodeDataClass", NodeDataClass);
    const instancePrefix = "geid_" + INSTANCE_ID() + "_";
    let edgeId = 0;
    const edgeKeyGenerator = () => {
      let availableEdgeKey;
      do {
        availableEdgeKey = instancePrefix + edgeId++;
      } while (this._edges.has(availableEdgeKey));
      return availableEdgeKey;
    };
    privateProperty(this, "_attributes", {});
    privateProperty(this, "_nodes", /* @__PURE__ */ new Map());
    privateProperty(this, "_edges", /* @__PURE__ */ new Map());
    privateProperty(this, "_directedSize", 0);
    privateProperty(this, "_undirectedSize", 0);
    privateProperty(this, "_directedSelfLoopCount", 0);
    privateProperty(this, "_undirectedSelfLoopCount", 0);
    privateProperty(this, "_edgeKeyGenerator", edgeKeyGenerator);
    privateProperty(this, "_options", options);
    EMITTER_PROPS.forEach((prop) => privateProperty(this, prop, this[prop]));
    readOnlyProperty(this, "order", () => this._nodes.size);
    readOnlyProperty(this, "size", () => this._edges.size);
    readOnlyProperty(this, "directedSize", () => this._directedSize);
    readOnlyProperty(this, "undirectedSize", () => this._undirectedSize);
    readOnlyProperty(
      this,
      "selfLoopCount",
      () => this._directedSelfLoopCount + this._undirectedSelfLoopCount
    );
    readOnlyProperty(
      this,
      "directedSelfLoopCount",
      () => this._directedSelfLoopCount
    );
    readOnlyProperty(
      this,
      "undirectedSelfLoopCount",
      () => this._undirectedSelfLoopCount
    );
    readOnlyProperty(this, "multi", this._options.multi);
    readOnlyProperty(this, "type", this._options.type);
    readOnlyProperty(this, "allowSelfLoops", this._options.allowSelfLoops);
    readOnlyProperty(this, "implementation", () => "graphology");
  }
  _resetInstanceCounters() {
    this._directedSize = 0;
    this._undirectedSize = 0;
    this._directedSelfLoopCount = 0;
    this._undirectedSelfLoopCount = 0;
  }
  /**---------------------------------------------------------------------------
   * Read
   **---------------------------------------------------------------------------
   */
  /**
   * Method returning whether the given node is found in the graph.
   *
   * @param  {any}     node - The node.
   * @return {boolean}
   */
  hasNode(node) {
    return this._nodes.has("" + node);
  }
  /**
   * Method returning whether the given directed edge is found in the graph.
   *
   * Arity 1:
   * @param  {any}     edge - The edge's key.
   *
   * Arity 2:
   * @param  {any}     source - The edge's source.
   * @param  {any}     target - The edge's target.
   *
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the arguments are invalid.
   */
  hasDirectedEdge(source, target) {
    if (this.type === "undirected") return false;
    if (arguments.length === 1) {
      const edge = "" + source;
      const edgeData = this._edges.get(edge);
      return !!edgeData && !edgeData.undirected;
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData) return false;
      return nodeData.out.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(
      `Graph.hasDirectedEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`
    );
  }
  /**
   * Method returning whether the given undirected edge is found in the graph.
   *
   * Arity 1:
   * @param  {any}     edge - The edge's key.
   *
   * Arity 2:
   * @param  {any}     source - The edge's source.
   * @param  {any}     target - The edge's target.
   *
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the arguments are invalid.
   */
  hasUndirectedEdge(source, target) {
    if (this.type === "directed") return false;
    if (arguments.length === 1) {
      const edge = "" + source;
      const edgeData = this._edges.get(edge);
      return !!edgeData && edgeData.undirected;
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData) return false;
      return nodeData.undirected.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(
      `Graph.hasDirectedEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`
    );
  }
  /**
   * Method returning whether the given edge is found in the graph.
   *
   * Arity 1:
   * @param  {any}     edge - The edge's key.
   *
   * Arity 2:
   * @param  {any}     source - The edge's source.
   * @param  {any}     target - The edge's target.
   *
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the arguments are invalid.
   */
  hasEdge(source, target) {
    if (arguments.length === 1) {
      const edge = "" + source;
      return this._edges.has(edge);
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData) return false;
      return typeof nodeData.out !== "undefined" && nodeData.out.hasOwnProperty(target) || typeof nodeData.undirected !== "undefined" && nodeData.undirected.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(
      `Graph.hasEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`
    );
  }
  /**
   * Method returning the edge matching source & target in a directed fashion.
   *
   * @param  {any} source - The edge's source.
   * @param  {any} target - The edge's target.
   *
   * @return {any|undefined}
   *
   * @throws {Error} - Will throw if the graph is multi.
   * @throws {Error} - Will throw if source or target doesn't exist.
   */
  directedEdge(source, target) {
    if (this.type === "undirected") return;
    source = "" + source;
    target = "" + target;
    if (this.multi)
      throw new UsageGraphError(
        "Graph.directedEdge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.directedEdges instead."
      );
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(
        `Graph.directedEdge: could not find the "${source}" source node in the graph.`
      );
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(
        `Graph.directedEdge: could not find the "${target}" target node in the graph.`
      );
    const edgeData = sourceData.out && sourceData.out[target] || void 0;
    if (edgeData) return edgeData.key;
  }
  /**
   * Method returning the edge matching source & target in a undirected fashion.
   *
   * @param  {any} source - The edge's source.
   * @param  {any} target - The edge's target.
   *
   * @return {any|undefined}
   *
   * @throws {Error} - Will throw if the graph is multi.
   * @throws {Error} - Will throw if source or target doesn't exist.
   */
  undirectedEdge(source, target) {
    if (this.type === "directed") return;
    source = "" + source;
    target = "" + target;
    if (this.multi)
      throw new UsageGraphError(
        "Graph.undirectedEdge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.undirectedEdges instead."
      );
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(
        `Graph.undirectedEdge: could not find the "${source}" source node in the graph.`
      );
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(
        `Graph.undirectedEdge: could not find the "${target}" target node in the graph.`
      );
    const edgeData = sourceData.undirected && sourceData.undirected[target] || void 0;
    if (edgeData) return edgeData.key;
  }
  /**
   * Method returning the edge matching source & target in a mixed fashion.
   *
   * @param  {any} source - The edge's source.
   * @param  {any} target - The edge's target.
   *
   * @return {any|undefined}
   *
   * @throws {Error} - Will throw if the graph is multi.
   * @throws {Error} - Will throw if source or target doesn't exist.
   */
  edge(source, target) {
    if (this.multi)
      throw new UsageGraphError(
        "Graph.edge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.edges instead."
      );
    source = "" + source;
    target = "" + target;
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(
        `Graph.edge: could not find the "${source}" source node in the graph.`
      );
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(
        `Graph.edge: could not find the "${target}" target node in the graph.`
      );
    const edgeData = sourceData.out && sourceData.out[target] || sourceData.undirected && sourceData.undirected[target] || void 0;
    if (edgeData) return edgeData.key;
  }
  /**
   * Method returning whether two nodes are directed neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areDirectedNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areDirectedNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return false;
    return neighbor in nodeData.in || neighbor in nodeData.out;
  }
  /**
   * Method returning whether two nodes are out neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areOutNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areOutNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return false;
    return neighbor in nodeData.out;
  }
  /**
   * Method returning whether two nodes are in neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areInNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areInNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return false;
    return neighbor in nodeData.in;
  }
  /**
   * Method returning whether two nodes are undirected neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areUndirectedNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areUndirectedNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type === "directed") return false;
    return neighbor in nodeData.undirected;
  }
  /**
   * Method returning whether two nodes are neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type !== "undirected") {
      if (neighbor in nodeData.in || neighbor in nodeData.out) return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected) return true;
    }
    return false;
  }
  /**
   * Method returning whether two nodes are inbound neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areInboundNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areInboundNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type !== "undirected") {
      if (neighbor in nodeData.in) return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected) return true;
    }
    return false;
  }
  /**
   * Method returning whether two nodes are outbound neighbors.
   *
   * @param  {any}     node     - The node's key.
   * @param  {any}     neighbor - The neighbor's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  areOutboundNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.areOutboundNeighbors: could not find the "${node}" node in the graph.`
      );
    if (this.type !== "undirected") {
      if (neighbor in nodeData.out) return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected) return true;
    }
    return false;
  }
  /**
   * Method returning the given node's in degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  inDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.inDegree: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.inDegree;
  }
  /**
   * Method returning the given node's out degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  outDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.outDegree: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.outDegree;
  }
  /**
   * Method returning the given node's directed degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  directedDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.directedDegree: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.inDegree + nodeData.outDegree;
  }
  /**
   * Method returning the given node's undirected degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  undirectedDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.undirectedDegree: could not find the "${node}" node in the graph.`
      );
    if (this.type === "directed") return 0;
    return nodeData.undirectedDegree;
  }
  /**
   * Method returning the given node's inbound degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's inbound degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  inboundDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.inboundDegree: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree;
    }
    return degree;
  }
  /**
   * Method returning the given node's outbound degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's outbound degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  outboundDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.outboundDegree: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.outDegree;
    }
    return degree;
  }
  /**
   * Method returning the given node's directed degree.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  degree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.degree: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree + nodeData.outDegree;
    }
    return degree;
  }
  /**
   * Method returning the given node's in degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  inDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.inDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.inDegree - nodeData.directedLoops;
  }
  /**
   * Method returning the given node's out degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  outDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.outDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.outDegree - nodeData.directedLoops;
  }
  /**
   * Method returning the given node's directed degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  directedDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.directedDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    if (this.type === "undirected") return 0;
    return nodeData.inDegree + nodeData.outDegree - nodeData.directedLoops * 2;
  }
  /**
   * Method returning the given node's undirected degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's in degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  undirectedDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.undirectedDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    if (this.type === "directed") return 0;
    return nodeData.undirectedDegree - nodeData.undirectedLoops * 2;
  }
  /**
   * Method returning the given node's inbound degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's inbound degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  inboundDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.inboundDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree;
      loops += nodeData.directedLoops;
    }
    return degree - loops;
  }
  /**
   * Method returning the given node's outbound degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's outbound degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  outboundDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.outboundDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.outDegree;
      loops += nodeData.directedLoops;
    }
    return degree - loops;
  }
  /**
   * Method returning the given node's directed degree without considering self loops.
   *
   * @param  {any}     node - The node's key.
   * @return {number}       - The node's degree.
   *
   * @throws {Error} - Will throw if the node isn't in the graph.
   */
  degreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.degreeWithoutSelfLoops: could not find the "${node}" node in the graph.`
      );
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree + nodeData.outDegree;
      loops += nodeData.directedLoops * 2;
    }
    return degree - loops;
  }
  /**
   * Method returning the given edge's source.
   *
   * @param  {any} edge - The edge's key.
   * @return {any}      - The edge's source.
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  source(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.source: could not find the "${edge}" edge in the graph.`
      );
    return data.source.key;
  }
  /**
   * Method returning the given edge's target.
   *
   * @param  {any} edge - The edge's key.
   * @return {any}      - The edge's target.
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  target(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.target: could not find the "${edge}" edge in the graph.`
      );
    return data.target.key;
  }
  /**
   * Method returning the given edge's extremities.
   *
   * @param  {any}   edge - The edge's key.
   * @return {array}      - The edge's extremities.
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  extremities(edge) {
    edge = "" + edge;
    const edgeData = this._edges.get(edge);
    if (!edgeData)
      throw new NotFoundGraphError(
        `Graph.extremities: could not find the "${edge}" edge in the graph.`
      );
    return [edgeData.source.key, edgeData.target.key];
  }
  /**
   * Given a node & an edge, returns the other extremity of the edge.
   *
   * @param  {any}   node - The node's key.
   * @param  {any}   edge - The edge's key.
   * @return {any}        - The related node.
   *
   * @throws {Error} - Will throw if the edge isn't in the graph or if the
   *                   edge & node are not related.
   */
  opposite(node, edge) {
    node = "" + node;
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.opposite: could not find the "${edge}" edge in the graph.`
      );
    const source = data.source.key;
    const target = data.target.key;
    if (node === source) return target;
    if (node === target) return source;
    throw new NotFoundGraphError(
      `Graph.opposite: the "${node}" node is not attached to the "${edge}" edge (${source}, ${target}).`
    );
  }
  /**
   * Returns whether the given edge has the given node as extremity.
   *
   * @param  {any}     edge - The edge's key.
   * @param  {any}     node - The node's key.
   * @return {boolean}      - The related node.
   *
   * @throws {Error} - Will throw if either the node or the edge isn't in the graph.
   */
  hasExtremity(edge, node) {
    edge = "" + edge;
    node = "" + node;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.hasExtremity: could not find the "${edge}" edge in the graph.`
      );
    return data.source.key === node || data.target.key === node;
  }
  /**
   * Method returning whether the given edge is undirected.
   *
   * @param  {any}     edge - The edge's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  isUndirected(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.isUndirected: could not find the "${edge}" edge in the graph.`
      );
    return data.undirected;
  }
  /**
   * Method returning whether the given edge is directed.
   *
   * @param  {any}     edge - The edge's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  isDirected(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.isDirected: could not find the "${edge}" edge in the graph.`
      );
    return !data.undirected;
  }
  /**
   * Method returning whether the given edge is a self loop.
   *
   * @param  {any}     edge - The edge's key.
   * @return {boolean}
   *
   * @throws {Error} - Will throw if the edge isn't in the graph.
   */
  isSelfLoop(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(
        `Graph.isSelfLoop: could not find the "${edge}" edge in the graph.`
      );
    return data.source === data.target;
  }
  /**---------------------------------------------------------------------------
   * Mutation
   **---------------------------------------------------------------------------
   */
  /**
   * Method used to add a node to the graph.
   *
   * @param  {any}    node         - The node.
   * @param  {object} [attributes] - Optional attributes.
   * @return {any}                 - The node.
   *
   * @throws {Error} - Will throw if the given node already exist.
   * @throws {Error} - Will throw if the given attributes are not an object.
   */
  addNode(node, attributes) {
    const nodeData = addNode(this, node, attributes);
    return nodeData.key;
  }
  /**
   * Method used to merge a node into the graph.
   *
   * @param  {any}    node         - The node.
   * @param  {object} [attributes] - Optional attributes.
   * @return {any}                 - The node.
   */
  mergeNode(node, attributes) {
    if (attributes && !isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        `Graph.mergeNode: invalid attributes. Expecting an object but got "${attributes}"`
      );
    node = "" + node;
    attributes = attributes || {};
    let data = this._nodes.get(node);
    if (data) {
      if (attributes) {
        assign(data.attributes, attributes);
        this.emit("nodeAttributesUpdated", {
          type: "merge",
          key: node,
          attributes: data.attributes,
          data: attributes
        });
      }
      return [node, false];
    }
    data = new this.NodeDataClass(node, attributes);
    this._nodes.set(node, data);
    this.emit("nodeAdded", {
      key: node,
      attributes
    });
    return [node, true];
  }
  /**
   * Method used to add a node if it does not exist in the graph or else to
   * update its attributes using a function.
   *
   * @param  {any}      node      - The node.
   * @param  {function} [updater] - Optional updater function.
   * @return {any}                - The node.
   */
  updateNode(node, updater) {
    if (updater && typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        `Graph.updateNode: invalid updater function. Expecting a function but got "${updater}"`
      );
    node = "" + node;
    let data = this._nodes.get(node);
    if (data) {
      if (updater) {
        const oldAttributes = data.attributes;
        data.attributes = updater(oldAttributes);
        this.emit("nodeAttributesUpdated", {
          type: "replace",
          key: node,
          attributes: data.attributes
        });
      }
      return [node, false];
    }
    const attributes = updater ? updater({}) : {};
    data = new this.NodeDataClass(node, attributes);
    this._nodes.set(node, data);
    this.emit("nodeAdded", {
      key: node,
      attributes
    });
    return [node, true];
  }
  /**
   * Method used to drop a single node & all its attached edges from the graph.
   *
   * @param  {any}    node - The node.
   * @return {Graph}
   *
   * @throws {Error} - Will throw if the node doesn't exist.
   */
  dropNode(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(
        `Graph.dropNode: could not find the "${node}" node in the graph.`
      );
    let edgeData;
    if (this.type !== "undirected") {
      for (const neighbor in nodeData.out) {
        edgeData = nodeData.out[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
      for (const neighbor in nodeData.in) {
        edgeData = nodeData.in[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (this.type !== "directed") {
      for (const neighbor in nodeData.undirected) {
        edgeData = nodeData.undirected[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    this._nodes.delete(node);
    this.emit("nodeDropped", {
      key: node,
      attributes: nodeData.attributes
    });
  }
  /**
   * Method used to drop a single edge from the graph.
   *
   * Arity 1:
   * @param  {any}    edge - The edge.
   *
   * Arity 2:
   * @param  {any}    source - Source node.
   * @param  {any}    target - Target node.
   *
   * @return {Graph}
   *
   * @throws {Error} - Will throw if the edge doesn't exist.
   */
  dropEdge(edge) {
    let edgeData;
    if (arguments.length > 1) {
      const source = "" + arguments[0];
      const target = "" + arguments[1];
      edgeData = getMatchingEdge(this, source, target, this.type);
      if (!edgeData)
        throw new NotFoundGraphError(
          `Graph.dropEdge: could not find the "${source}" -> "${target}" edge in the graph.`
        );
    } else {
      edge = "" + edge;
      edgeData = this._edges.get(edge);
      if (!edgeData)
        throw new NotFoundGraphError(
          `Graph.dropEdge: could not find the "${edge}" edge in the graph.`
        );
    }
    dropEdgeFromData(this, edgeData);
    return this;
  }
  /**
   * Method used to drop a single directed edge from the graph.
   *
   * @param  {any}    source - Source node.
   * @param  {any}    target - Target node.
   *
   * @return {Graph}
   *
   * @throws {Error} - Will throw if the edge doesn't exist.
   */
  dropDirectedEdge(source, target) {
    if (arguments.length < 2)
      throw new UsageGraphError(
        "Graph.dropDirectedEdge: it does not make sense to try and drop a directed edge by key. What if the edge with this key is undirected? Use #.dropEdge for this purpose instead."
      );
    if (this.multi)
      throw new UsageGraphError(
        "Graph.dropDirectedEdge: cannot use a {source,target} combo when dropping an edge in a MultiGraph since we cannot infer the one you want to delete as there could be multiple ones."
      );
    source = "" + source;
    target = "" + target;
    const edgeData = getMatchingEdge(this, source, target, "directed");
    if (!edgeData)
      throw new NotFoundGraphError(
        `Graph.dropDirectedEdge: could not find a "${source}" -> "${target}" edge in the graph.`
      );
    dropEdgeFromData(this, edgeData);
    return this;
  }
  /**
   * Method used to drop a single undirected edge from the graph.
   *
   * @param  {any}    source - Source node.
   * @param  {any}    target - Target node.
   *
   * @return {Graph}
   *
   * @throws {Error} - Will throw if the edge doesn't exist.
   */
  dropUndirectedEdge(source, target) {
    if (arguments.length < 2)
      throw new UsageGraphError(
        "Graph.dropUndirectedEdge: it does not make sense to drop a directed edge by key. What if the edge with this key is undirected? Use #.dropEdge for this purpose instead."
      );
    if (this.multi)
      throw new UsageGraphError(
        "Graph.dropUndirectedEdge: cannot use a {source,target} combo when dropping an edge in a MultiGraph since we cannot infer the one you want to delete as there could be multiple ones."
      );
    const edgeData = getMatchingEdge(this, source, target, "undirected");
    if (!edgeData)
      throw new NotFoundGraphError(
        `Graph.dropUndirectedEdge: could not find a "${source}" -> "${target}" edge in the graph.`
      );
    dropEdgeFromData(this, edgeData);
    return this;
  }
  /**
   * Method used to remove every edge & every node from the graph.
   *
   * @return {Graph}
   */
  clear() {
    this._edges.clear();
    this._nodes.clear();
    this._resetInstanceCounters();
    this.emit("cleared");
  }
  /**
   * Method used to remove every edge from the graph.
   *
   * @return {Graph}
   */
  clearEdges() {
    const iterator = this._nodes.values();
    let step;
    while (step = iterator.next(), step.done !== true) {
      step.value.clear();
    }
    this._edges.clear();
    this._resetInstanceCounters();
    this.emit("edgesCleared");
  }
  /**---------------------------------------------------------------------------
   * Attributes-related methods
   **---------------------------------------------------------------------------
   */
  /**
   * Method returning the desired graph's attribute.
   *
   * @param  {string} name - Name of the attribute.
   * @return {any}
   */
  getAttribute(name) {
    return this._attributes[name];
  }
  /**
   * Method returning the graph's attributes.
   *
   * @return {object}
   */
  getAttributes() {
    return this._attributes;
  }
  /**
   * Method returning whether the graph has the desired attribute.
   *
   * @param  {string}  name - Name of the attribute.
   * @return {boolean}
   */
  hasAttribute(name) {
    return this._attributes.hasOwnProperty(name);
  }
  /**
   * Method setting a value for the desired graph's attribute.
   *
   * @param  {string}  name  - Name of the attribute.
   * @param  {any}     value - Value for the attribute.
   * @return {Graph}
   */
  setAttribute(name, value) {
    this._attributes[name] = value;
    this.emit("attributesUpdated", {
      type: "set",
      attributes: this._attributes,
      name
    });
    return this;
  }
  /**
   * Method using a function to update the desired graph's attribute's value.
   *
   * @param  {string}   name    - Name of the attribute.
   * @param  {function} updater - Function use to update the attribute's value.
   * @return {Graph}
   */
  updateAttribute(name, updater) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.updateAttribute: updater should be a function."
      );
    const value = this._attributes[name];
    this._attributes[name] = updater(value);
    this.emit("attributesUpdated", {
      type: "set",
      attributes: this._attributes,
      name
    });
    return this;
  }
  /**
   * Method removing the desired graph's attribute.
   *
   * @param  {string} name  - Name of the attribute.
   * @return {Graph}
   */
  removeAttribute(name) {
    delete this._attributes[name];
    this.emit("attributesUpdated", {
      type: "remove",
      attributes: this._attributes,
      name
    });
    return this;
  }
  /**
   * Method replacing the graph's attributes.
   *
   * @param  {object} attributes - New attributes.
   * @return {Graph}
   *
   * @throws {Error} - Will throw if given attributes are not a plain object.
   */
  replaceAttributes(attributes) {
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        "Graph.replaceAttributes: provided attributes are not a plain object."
      );
    this._attributes = attributes;
    this.emit("attributesUpdated", {
      type: "replace",
      attributes: this._attributes
    });
    return this;
  }
  /**
   * Method merging the graph's attributes.
   *
   * @param  {object} attributes - Attributes to merge.
   * @return {Graph}
   *
   * @throws {Error} - Will throw if given attributes are not a plain object.
   */
  mergeAttributes(attributes) {
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(
        "Graph.mergeAttributes: provided attributes are not a plain object."
      );
    assign(this._attributes, attributes);
    this.emit("attributesUpdated", {
      type: "merge",
      attributes: this._attributes,
      data: attributes
    });
    return this;
  }
  /**
   * Method updating the graph's attributes.
   *
   * @param  {function} updater - Function used to update the attributes.
   * @return {Graph}
   *
   * @throws {Error} - Will throw if given updater is not a function.
   */
  updateAttributes(updater) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.updateAttributes: provided updater is not a function."
      );
    this._attributes = updater(this._attributes);
    this.emit("attributesUpdated", {
      type: "update",
      attributes: this._attributes
    });
    return this;
  }
  /**
   * Method used to update each node's attributes using the given function.
   *
   * @param {function}  updater - Updater function to use.
   * @param {object}    [hints] - Optional hints.
   */
  updateEachNodeAttributes(updater, hints) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.updateEachNodeAttributes: expecting an updater function."
      );
    if (hints && !validateHints(hints))
      throw new InvalidArgumentsGraphError(
        "Graph.updateEachNodeAttributes: invalid hints. Expecting an object having the following shape: {attributes?: [string]}"
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      nodeData.attributes = updater(nodeData.key, nodeData.attributes);
    }
    this.emit("eachNodeAttributesUpdated", {
      hints: hints ? hints : null
    });
  }
  /**
   * Method used to update each edge's attributes using the given function.
   *
   * @param {function}  updater - Updater function to use.
   * @param {object}    [hints] - Optional hints.
   */
  updateEachEdgeAttributes(updater, hints) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.updateEachEdgeAttributes: expecting an updater function."
      );
    if (hints && !validateHints(hints))
      throw new InvalidArgumentsGraphError(
        "Graph.updateEachEdgeAttributes: invalid hints. Expecting an object having the following shape: {attributes?: [string]}"
      );
    const iterator = this._edges.values();
    let step, edgeData, sourceData, targetData;
    while (step = iterator.next(), step.done !== true) {
      edgeData = step.value;
      sourceData = edgeData.source;
      targetData = edgeData.target;
      edgeData.attributes = updater(
        edgeData.key,
        edgeData.attributes,
        sourceData.key,
        targetData.key,
        sourceData.attributes,
        targetData.attributes,
        edgeData.undirected
      );
    }
    this.emit("eachEdgeAttributesUpdated", {
      hints: hints ? hints : null
    });
  }
  /**---------------------------------------------------------------------------
   * Iteration-related methods
   **---------------------------------------------------------------------------
   */
  /**
   * Method iterating over the graph's adjacency using the given callback.
   *
   * @param  {function}  callback - Callback to use.
   */
  forEachAdjacencyEntry(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.forEachAdjacencyEntry: expecting a callback."
      );
    forEachAdjacency(false, false, false, this, callback);
  }
  forEachAdjacencyEntryWithOrphans(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.forEachAdjacencyEntryWithOrphans: expecting a callback."
      );
    forEachAdjacency(false, false, true, this, callback);
  }
  /**
   * Method iterating over the graph's assymetric adjacency using the given callback.
   *
   * @param  {function}  callback - Callback to use.
   */
  forEachAssymetricAdjacencyEntry(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.forEachAssymetricAdjacencyEntry: expecting a callback."
      );
    forEachAdjacency(false, true, false, this, callback);
  }
  forEachAssymetricAdjacencyEntryWithOrphans(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.forEachAssymetricAdjacencyEntryWithOrphans: expecting a callback."
      );
    forEachAdjacency(false, true, true, this, callback);
  }
  /**
   * Method returning the list of the graph's nodes.
   *
   * @return {array} - The nodes.
   */
  nodes() {
    return Array.from(this._nodes.keys());
  }
  /**
   * Method iterating over the graph's nodes using the given callback.
   *
   * @param  {function}  callback - Callback (key, attributes, index).
   */
  forEachNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.forEachNode: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      callback(nodeData.key, nodeData.attributes);
    }
  }
  /**
   * Method iterating attempting to find a node matching the given predicate
   * function.
   *
   * @param  {function}  callback - Callback (key, attributes).
   */
  findNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.findNode: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes)) return nodeData.key;
    }
    return;
  }
  /**
   * Method mapping nodes.
   *
   * @param  {function}  callback - Callback (key, attributes).
   */
  mapNodes(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.mapNode: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    const result = new Array(this.order);
    let i = 0;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      result[i++] = callback(nodeData.key, nodeData.attributes);
    }
    return result;
  }
  /**
   * Method returning whether some node verify the given predicate.
   *
   * @param  {function}  callback - Callback (key, attributes).
   */
  someNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.someNode: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes)) return true;
    }
    return false;
  }
  /**
   * Method returning whether all node verify the given predicate.
   *
   * @param  {function}  callback - Callback (key, attributes).
   */
  everyNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.everyNode: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (!callback(nodeData.key, nodeData.attributes)) return false;
    }
    return true;
  }
  /**
   * Method filtering nodes.
   *
   * @param  {function}  callback - Callback (key, attributes).
   */
  filterNodes(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.filterNodes: expecting a callback."
      );
    const iterator = this._nodes.values();
    let step, nodeData;
    const result = [];
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes))
        result.push(nodeData.key);
    }
    return result;
  }
  /**
   * Method reducing nodes.
   *
   * @param  {function}  callback - Callback (accumulator, key, attributes).
   */
  reduceNodes(callback, initialValue) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError(
        "Graph.reduceNodes: expecting a callback."
      );
    if (arguments.length < 2)
      throw new InvalidArgumentsGraphError(
        "Graph.reduceNodes: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array."
      );
    let accumulator = initialValue;
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      accumulator = callback(accumulator, nodeData.key, nodeData.attributes);
    }
    return accumulator;
  }
  /**
   * Method returning an iterator over the graph's node entries.
   *
   * @return {Iterator}
   */
  nodeEntries() {
    const iterator = this._nodes.values();
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        const step = iterator.next();
        if (step.done) return step;
        const data = step.value;
        return {
          value: { node: data.key, attributes: data.attributes },
          done: false
        };
      }
    };
  }
  /**---------------------------------------------------------------------------
   * Serialization
   **---------------------------------------------------------------------------
   */
  /**
   * Method used to export the whole graph.
   *
   * @return {object} - The serialized graph.
   */
  export() {
    const nodes = new Array(this._nodes.size);
    let i = 0;
    this._nodes.forEach((data, key) => {
      nodes[i++] = serializeNode(key, data);
    });
    const edges = new Array(this._edges.size);
    i = 0;
    this._edges.forEach((data, key) => {
      edges[i++] = serializeEdge(this.type, key, data);
    });
    return {
      options: {
        type: this.type,
        multi: this.multi,
        allowSelfLoops: this.allowSelfLoops
      },
      attributes: this.getAttributes(),
      nodes,
      edges
    };
  }
  /**
   * Method used to import a serialized graph.
   *
   * @param  {object|Graph} data  - The serialized graph.
   * @param  {boolean}      merge - Whether to merge data.
   * @return {Graph}              - Returns itself for chaining.
   */
  import(data, merge2 = false) {
    if (data instanceof _Graph) {
      data.forEachNode((n, a) => {
        if (merge2) this.mergeNode(n, a);
        else this.addNode(n, a);
      });
      data.forEachEdge((e, a, s, t, _sa, _ta, u) => {
        if (merge2) {
          if (u) this.mergeUndirectedEdgeWithKey(e, s, t, a);
          else this.mergeDirectedEdgeWithKey(e, s, t, a);
        } else {
          if (u) this.addUndirectedEdgeWithKey(e, s, t, a);
          else this.addDirectedEdgeWithKey(e, s, t, a);
        }
      });
      return this;
    }
    if (!isPlainObject(data))
      throw new InvalidArgumentsGraphError(
        "Graph.import: invalid argument. Expecting a serialized graph or, alternatively, a Graph instance."
      );
    if (data.attributes) {
      if (!isPlainObject(data.attributes))
        throw new InvalidArgumentsGraphError(
          "Graph.import: invalid attributes. Expecting a plain object."
        );
      if (merge2) this.mergeAttributes(data.attributes);
      else this.replaceAttributes(data.attributes);
    }
    let i, l, list, node, edge;
    if (data.nodes) {
      list = data.nodes;
      if (!Array.isArray(list))
        throw new InvalidArgumentsGraphError(
          "Graph.import: invalid nodes. Expecting an array."
        );
      for (i = 0, l = list.length; i < l; i++) {
        node = list[i];
        validateSerializedNode(node);
        const { key, attributes } = node;
        if (merge2) this.mergeNode(key, attributes);
        else this.addNode(key, attributes);
      }
    }
    if (data.edges) {
      let undirectedByDefault = false;
      if (this.type === "undirected") {
        undirectedByDefault = true;
      }
      list = data.edges;
      if (!Array.isArray(list))
        throw new InvalidArgumentsGraphError(
          "Graph.import: invalid edges. Expecting an array."
        );
      for (i = 0, l = list.length; i < l; i++) {
        edge = list[i];
        validateSerializedEdge(edge);
        const {
          source,
          target,
          attributes,
          undirected = undirectedByDefault
        } = edge;
        let method;
        if ("key" in edge) {
          method = merge2 ? undirected ? this.mergeUndirectedEdgeWithKey : this.mergeDirectedEdgeWithKey : undirected ? this.addUndirectedEdgeWithKey : this.addDirectedEdgeWithKey;
          method.call(this, edge.key, source, target, attributes);
        } else {
          method = merge2 ? undirected ? this.mergeUndirectedEdge : this.mergeDirectedEdge : undirected ? this.addUndirectedEdge : this.addDirectedEdge;
          method.call(this, source, target, attributes);
        }
      }
    }
    return this;
  }
  /**---------------------------------------------------------------------------
   * Utils
   **---------------------------------------------------------------------------
   */
  /**
   * Method returning a null copy of the graph, i.e. a graph without nodes
   * & edges but with the exact same options.
   *
   * @param  {object} options - Options to merge with the current ones.
   * @return {Graph}          - The null copy.
   */
  nullCopy(options) {
    const graph = new _Graph(assign({}, this._options, options));
    graph.replaceAttributes(assign({}, this.getAttributes()));
    return graph;
  }
  /**
   * Method returning an empty copy of the graph, i.e. a graph without edges but
   * with the exact same options.
   *
   * @param  {object} options - Options to merge with the current ones.
   * @return {Graph}          - The empty copy.
   */
  emptyCopy(options) {
    const graph = this.nullCopy(options);
    this._nodes.forEach((nodeData, key) => {
      const attributes = assign({}, nodeData.attributes);
      nodeData = new graph.NodeDataClass(key, attributes);
      graph._nodes.set(key, nodeData);
    });
    return graph;
  }
  /**
   * Method returning an exact copy of the graph.
   *
   * @param  {object} options - Upgrade options.
   * @return {Graph}          - The copy.
   */
  copy(options) {
    options = options || {};
    if (typeof options.type === "string" && options.type !== this.type && options.type !== "mixed")
      throw new UsageGraphError(
        `Graph.copy: cannot create an incompatible copy from "${this.type}" type to "${options.type}" because this would mean losing information about the current graph.`
      );
    if (typeof options.multi === "boolean" && options.multi !== this.multi && options.multi !== true)
      throw new UsageGraphError(
        "Graph.copy: cannot create an incompatible copy by downgrading a multi graph to a simple one because this would mean losing information about the current graph."
      );
    if (typeof options.allowSelfLoops === "boolean" && options.allowSelfLoops !== this.allowSelfLoops && options.allowSelfLoops !== true)
      throw new UsageGraphError(
        "Graph.copy: cannot create an incompatible copy from a graph allowing self loops to one that does not because this would mean losing information about the current graph."
      );
    const graph = this.emptyCopy(options);
    const iterator = this._edges.values();
    let step, edgeData;
    while (step = iterator.next(), step.done !== true) {
      edgeData = step.value;
      addEdge(
        graph,
        "copy",
        false,
        edgeData.undirected,
        edgeData.key,
        edgeData.source.key,
        edgeData.target.key,
        assign({}, edgeData.attributes)
      );
    }
    return graph;
  }
  /**---------------------------------------------------------------------------
   * Known methods
   **---------------------------------------------------------------------------
   */
  /**
   * Method used by JavaScript to perform JSON serialization.
   *
   * @return {object} - The serialized graph.
   */
  toJSON() {
    return this.export();
  }
  /**
   * Method returning [object Graph].
   */
  toString() {
    return "[object Graph]";
  }
  /**
   * Method used internally by node's console to display a custom object.
   *
   * @return {object} - Formatted object representation of the graph.
   */
  inspect() {
    const nodes = {};
    this._nodes.forEach((data, key) => {
      nodes[key] = data.attributes;
    });
    const edges = {}, multiIndex = {};
    this._edges.forEach((data, key) => {
      const direction = data.undirected ? "--" : "->";
      let label = "";
      let source = data.source.key;
      let target = data.target.key;
      let tmp;
      if (data.undirected && source > target) {
        tmp = source;
        source = target;
        target = tmp;
      }
      const desc = `(${source})${direction}(${target})`;
      if (!key.startsWith("geid_")) {
        label += `[${key}]: `;
      } else if (this.multi) {
        if (typeof multiIndex[desc] === "undefined") {
          multiIndex[desc] = 0;
        } else {
          multiIndex[desc]++;
        }
        label += `${multiIndex[desc]}. `;
      }
      label += desc;
      edges[label] = data.attributes;
    });
    const dummy = {};
    for (const k in this) {
      if (this.hasOwnProperty(k) && !EMITTER_PROPS.has(k) && typeof this[k] !== "function" && typeof k !== "symbol")
        dummy[k] = this[k];
    }
    dummy.attributes = this._attributes;
    dummy.nodes = nodes;
    dummy.edges = edges;
    privateProperty(dummy, "constructor", this.constructor);
    return dummy;
  }
};
if (typeof Symbol !== "undefined")
  Graph.prototype[Symbol.for("nodejs.util.inspect.custom")] = Graph.prototype.inspect;
EDGE_ADD_METHODS.forEach((method) => {
  ["add", "merge", "update"].forEach((verb) => {
    const name = method.name(verb);
    const fn = verb === "add" ? addEdge : mergeEdge;
    if (method.generateKey) {
      Graph.prototype[name] = function(source, target, attributes) {
        return fn(
          this,
          name,
          true,
          (method.type || this.type) === "undirected",
          null,
          source,
          target,
          attributes,
          verb === "update"
        );
      };
    } else {
      Graph.prototype[name] = function(edge, source, target, attributes) {
        return fn(
          this,
          name,
          false,
          (method.type || this.type) === "undirected",
          edge,
          source,
          target,
          attributes,
          verb === "update"
        );
      };
    }
  });
});
attachNodeAttributesMethods(Graph);
attachEdgeAttributesMethods(Graph);
attachEdgeIterationMethods(Graph);
attachNeighborIterationMethods(Graph);
var DirectedGraph = class extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "directed" }, options);
    if ("multi" in finalOptions && finalOptions.multi !== false)
      throw new InvalidArgumentsGraphError(
        "DirectedGraph.from: inconsistent indication that the graph should be multi in given options!"
      );
    if (finalOptions.type !== "directed")
      throw new InvalidArgumentsGraphError(
        'DirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!'
      );
    super(finalOptions);
  }
};
var UndirectedGraph = class extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "undirected" }, options);
    if ("multi" in finalOptions && finalOptions.multi !== false)
      throw new InvalidArgumentsGraphError(
        "UndirectedGraph.from: inconsistent indication that the graph should be multi in given options!"
      );
    if (finalOptions.type !== "undirected")
      throw new InvalidArgumentsGraphError(
        'UndirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!'
      );
    super(finalOptions);
  }
};
var MultiGraph = class extends Graph {
  constructor(options) {
    const finalOptions = assign({ multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError(
        "MultiGraph.from: inconsistent indication that the graph should be simple in given options!"
      );
    super(finalOptions);
  }
};
var MultiDirectedGraph = class extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "directed", multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError(
        "MultiDirectedGraph.from: inconsistent indication that the graph should be simple in given options!"
      );
    if (finalOptions.type !== "directed")
      throw new InvalidArgumentsGraphError(
        'MultiDirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!'
      );
    super(finalOptions);
  }
};
var MultiUndirectedGraph = class extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "undirected", multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError(
        "MultiUndirectedGraph.from: inconsistent indication that the graph should be simple in given options!"
      );
    if (finalOptions.type !== "undirected")
      throw new InvalidArgumentsGraphError(
        'MultiUndirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!'
      );
    super(finalOptions);
  }
};
function attachStaticFromMethod(Class) {
  Class.from = function(data, options) {
    const finalOptions = assign({}, data.options, options);
    const instance = new Class(finalOptions);
    instance.import(data);
    return instance;
  };
}
attachStaticFromMethod(Graph);
attachStaticFromMethod(DirectedGraph);
attachStaticFromMethod(UndirectedGraph);
attachStaticFromMethod(MultiGraph);
attachStaticFromMethod(MultiDirectedGraph);
attachStaticFromMethod(MultiUndirectedGraph);
Graph.Graph = Graph;
Graph.DirectedGraph = DirectedGraph;
Graph.UndirectedGraph = UndirectedGraph;
Graph.MultiGraph = MultiGraph;
Graph.MultiDirectedGraph = MultiDirectedGraph;
Graph.MultiUndirectedGraph = MultiUndirectedGraph;
Graph.InvalidArgumentsGraphError = InvalidArgumentsGraphError;
Graph.NotFoundGraphError = NotFoundGraphError;
Graph.UsageGraphError = UsageGraphError;

// src/core/communities.ts
var import_graphology_communities_louvain = __toESM(require_graphology_communities_louvain(), 1);
var SPARSE_DENSITY_RATIO = 1.5;
var SPARSE_MIN_MEMBERS = 3;
function computeGraphDensity(nodeCount, edgeCount) {
  if (nodeCount < 2) return 0;
  return edgeCount / (nodeCount * (nodeCount - 1) / 2);
}
var MIN_RESOLUTION = 0.5;
var MAX_RESOLUTION = 3;
function clampResolution(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, value));
}
var COMMUNITY_SEED = 2654435769;
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function computeCommunityConnectivity(nodeCount, intraEdges) {
  const possibleEdges = nodeCount > 1 ? nodeCount * (nodeCount - 1) / 2 : 1;
  return {
    cohesion: intraEdges / possibleEdges,
    meanIntraDegree: nodeCount > 0 ? 2 * intraEdges / nodeCount : 0
  };
}
function isSparseCommunity(cohesion, nodeCount, graphDensity) {
  return nodeCount >= SPARSE_MIN_MEMBERS && cohesion < graphDensity * SPARSE_DENSITY_RATIO;
}
function deriveCommunities(nodes, edges, options = {}) {
  if (nodes.length === 0) return { assignments: /* @__PURE__ */ new Map(), communities: [] };
  const assignments = options.forcedAssignments ? new Map(options.forcedAssignments) : runLouvain(nodes, edges, options.resolution ?? 1, options.seed ?? COMMUNITY_SEED);
  return summarise(nodes, edges, assignments, options.previousCommunities);
}
function runLouvain(nodes, edges, resolution, seed) {
  const graph = new Graph({ type: "undirected", multi: false });
  for (const node of nodes) {
    if (!graph.hasNode(node.id)) graph.addNode(node.id);
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    if (graph.hasEdge(edge.source, edge.target)) {
      graph.updateEdge(edge.source, edge.target, (current) => ({
        weight: (current.weight ?? 1) + weight
      }));
    } else {
      graph.addEdge(edge.source, edge.target, { weight });
    }
  }
  if (graph.order === 0) return /* @__PURE__ */ new Map();
  if (graph.size === 0) {
    return new Map(nodes.map((node) => [node.id, 0]));
  }
  const raw = (0, import_graphology_communities_louvain.default)(graph, { resolution, rng: mulberry32(seed), randomWalk: true });
  return new Map(Object.entries(raw));
}
function summarise(nodes, edges, assignments, previousCommunities) {
  const nodeInfo = new Map(nodes.map((node) => [node.id, node]));
  const groups = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const communityId = assignments.get(node.id) ?? 0;
    const members = groups.get(communityId);
    if (members) members.push(node.id);
    else groups.set(communityId, [node.id]);
  }
  const intraEdgesByCommunity = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const sourceCommunity = assignments.get(edge.source);
    if (sourceCommunity === void 0) continue;
    if (sourceCommunity !== assignments.get(edge.target)) continue;
    intraEdgesByCommunity.set(sourceCommunity, (intraEdgesByCommunity.get(sourceCommunity) ?? 0) + 1);
  }
  const weightedDegree = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    weightedDegree.set(edge.source, (weightedDegree.get(edge.source) ?? 0) + weight);
    weightedDegree.set(edge.target, (weightedDegree.get(edge.target) ?? 0) + weight);
  }
  const communities = [];
  const graphDensity = computeGraphDensity(nodes.length, edges.length);
  for (const [communityId, memberIds] of groups) {
    const nodeCount = memberIds.length;
    const intraEdges = intraEdgesByCommunity.get(communityId) ?? 0;
    const { cohesion, meanIntraDegree } = computeCommunityConnectivity(nodeCount, intraEdges);
    const topNodes = [...memberIds].sort(
      (a, b) => (weightedDegree.get(b) ?? 0) - (weightedDegree.get(a) ?? 0) || (nodeInfo.get(b)?.linkCount ?? 0) - (nodeInfo.get(a)?.linkCount ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
    ).slice(0, 5).map((id) => nodeInfo.get(id)?.label ?? id);
    communities.push({
      id: communityId,
      nodeCount,
      intraEdges,
      cohesion,
      meanIntraDegree,
      topNodes,
      isSparse: isSparseCommunity(cohesion, nodeCount, graphDensity),
      nodeIds: [...memberIds]
    });
  }
  communities.sort((a, b) => b.nodeCount - a.nodeCount || a.id - b.id);
  const idRemap = previousCommunities?.length ? stableIdMapping(communities, previousCommunities) : new Map(communities.map((community, index) => [community.id, index]));
  const remapped = communities.map((community) => ({
    ...community,
    id: idRemap.get(community.id) ?? 0
  }));
  remapped.sort((a, b) => a.id - b.id);
  for (const [nodeId, oldId] of assignments) {
    assignments.set(nodeId, idRemap.get(oldId) ?? 0);
  }
  return { assignments, communities: remapped };
}
function stableIdMapping(communities, previous) {
  const previousMembers = /* @__PURE__ */ new Map();
  for (const community of previous) previousMembers.set(community.id, new Set(community.nodeIds));
  const pairs2 = [];
  for (const community of communities) {
    for (const prior of previous) {
      const members = previousMembers.get(prior.id);
      if (!members) continue;
      let overlap = 0;
      for (const id of community.nodeIds) if (members.has(id)) overlap += 1;
      if (overlap > 0) pairs2.push({ newId: community.id, previousId: prior.id, overlap });
    }
  }
  pairs2.sort((a, b) => b.overlap - a.overlap || a.newId - b.newId || a.previousId - b.previousId);
  const mapping = /* @__PURE__ */ new Map();
  const claimedPrevious = /* @__PURE__ */ new Set();
  for (const pair of pairs2) {
    if (mapping.has(pair.newId) || claimedPrevious.has(pair.previousId)) continue;
    mapping.set(pair.newId, pair.previousId);
    claimedPrevious.add(pair.previousId);
  }
  const used = new Set(mapping.values());
  const highestSeen = Math.max(-1, ...previous.map((community) => community.id));
  const free = [];
  for (let id = 0; id <= highestSeen; id += 1) if (!used.has(id)) free.push(id);
  let nextFresh = highestSeen + 1;
  for (const community of communities) {
    if (mapping.has(community.id)) continue;
    const slot = free.length > 0 ? free.shift() : nextFresh++;
    mapping.set(community.id, slot);
  }
  return mapping;
}

// src/core/workspace.ts
function folderKey(path2) {
  return path2.replace(/^\/+|\/+$/g, "");
}
function isUnder(path2, folder) {
  if (folder === "") return true;
  return path2 === folder || path2.startsWith(`${folder}/`);
}
function isInWorkspace(path2, folder, excluded = []) {
  if (!isUnder(path2, folderKey(folder))) return false;
  return !excluded.some((prefix) => {
    const key = folderKey(prefix);
    return key !== "" && isUnder(path2, key);
  });
}

// node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence)) return sequence;
    else if (isNothing(sequence)) return [];
    return [sequence];
  }
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count) {
    let result = "";
    for (let cycle = 0; cycle < count; cycle += 1) {
      result += string;
    }
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  common.isNothing = isNothing;
  common.isObject = isObject;
  common.toArray = toArray;
  common.repeat = repeat;
  common.isNegativeZero = isNegativeZero;
  common.extend = extend;
  return common;
}
var exception;
var hasRequiredException;
function requireException() {
  if (hasRequiredException) return exception;
  hasRequiredException = 1;
  function formatError(exception2, compact) {
    let where = "";
    const message = exception2.reason || "(unknown reason)";
    if (!exception2.mark) return message;
    if (exception2.mark.name) {
      where += 'in "' + exception2.mark.name + '" ';
    }
    where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
    if (!compact && exception2.mark.snippet) {
      where += "\n\n" + exception2.mark.snippet;
    }
    return message + " " + where;
  }
  function YAMLException2(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  YAMLException2.prototype = Object.create(Error.prototype);
  YAMLException2.prototype.constructor = YAMLException2;
  YAMLException2.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  exception = YAMLException2;
  return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
  if (hasRequiredSnippet) return snippet;
  hasRequiredSnippet = 1;
  const common2 = requireCommon();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
      pos: position - lineStart + head.length
      // relative position
    };
  }
  function padStart(string, max) {
    return common2.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer) return null;
    if (!options.maxLength) options.maxLength = 79;
    if (typeof options.indent !== "number") options.indent = 1;
    if (typeof options.linesBefore !== "number") options.linesBefore = 3;
    if (typeof options.linesAfter !== "number") options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1; i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo - i],
        lineEnds[foundLineNo - i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
        maxLineLength
      );
      result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
    result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
    for (let i = 1; i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo + i],
        lineEnds[foundLineNo + i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
        maxLineLength
      );
      result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
    }
    return result.replace(/\n$/, "");
  }
  snippet = makeSnippet;
  return snippet;
}
var type;
var hasRequiredType;
function requireType() {
  if (hasRequiredType) return type;
  hasRequiredType = 1;
  const YAMLException2 = requireException();
  const TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  const YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) {
      Object.keys(map2).forEach(function(style) {
        map2[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  function Type2(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
        throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  type = Type2;
  return type;
}
var schema;
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema) return schema;
  hasRequiredSchema = 1;
  const YAMLException2 = requireException();
  const Type2 = requireType();
  function compileList(schema2, name) {
    const result = [];
    schema2[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type2) {
      if (type2.multi) {
        result.multi[type2.kind].push(type2);
        result.multi["fallback"].push(type2);
      } else {
        result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
      }
    }
    for (let index = 0, length = arguments.length; index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  function Schema2(definition) {
    return this.extend(definition);
  }
  Schema2.prototype.extend = function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type2) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit) implicit = implicit.concat(definition.implicit);
      if (definition.explicit) explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type2.loadKind && type2.loadKind !== "scalar") {
        throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type2.multi) {
        throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    const result = Object.create(Schema2.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  schema = Schema2;
  return schema;
}
var str;
var hasRequiredStr;
function requireStr() {
  if (hasRequiredStr) return str;
  hasRequiredStr = 1;
  const Type2 = requireType();
  str = new Type2("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
  return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq) return seq;
  hasRequiredSeq = 1;
  const Type2 = requireType();
  seq = new Type2("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
  return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap) return map;
  hasRequiredMap = 1;
  const Type2 = requireType();
  map = new Type2("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
  return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
  if (hasRequiredFailsafe) return failsafe;
  hasRequiredFailsafe = 1;
  const Schema2 = requireSchema();
  failsafe = new Schema2({
    explicit: [
      requireStr(),
      requireSeq(),
      requireMap()
    ]
  });
  return failsafe;
}
var _null;
var hasRequired_null;
function require_null() {
  if (hasRequired_null) return _null;
  hasRequired_null = 1;
  const Type2 = requireType();
  function resolveYamlNull(data) {
    if (data === null) return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  _null = new Type2("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
  return _null;
}
var bool;
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool) return bool;
  hasRequiredBool = 1;
  const Type2 = requireType();
  function resolveYamlBoolean(data) {
    if (data === null) return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  bool = new Type2("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
  return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt) return int;
  hasRequiredInt = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null) return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max) return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max) return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (; index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1") return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (; index < max; index++) {
          if (!isHexCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (; index < max; index++) {
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
    }
    for (; index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits) return false;
    return isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-") sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0") return 0;
    if (ch === "0") {
      if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
  }
  int = new Type2("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat) return float;
  hasRequiredFloat = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  const YAML_FLOAT_PATTERN = new RegExp(
    // 2.5e4, 2.5 and integers
    "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
    "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  function resolveYamlFloat(data) {
    if (data === null) return false;
    if (!YAML_FLOAT_PATTERN.test(data)) {
      return false;
    }
    if (isFinite(parseFloat(data, 10))) {
      return true;
    }
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common2.isNegativeZero(object)) {
      return "-0.0";
    }
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
  }
  float = new Type2("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  return float;
}
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson) return json;
  hasRequiredJson = 1;
  json = requireFailsafe().extend({
    implicit: [
      require_null(),
      requireBool(),
      requireInt(),
      requireFloat()
    ]
  });
  return json;
}
var core;
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore) return core;
  hasRequiredCore = 1;
  core = requireJson();
  return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp) return timestamp;
  hasRequiredTimestamp = 1;
  const Type2 = requireType();
  const YAML_DATE_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
  );
  const YAML_TIMESTAMP_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
  );
  function resolveYamlTimestamp(data) {
    if (data === null) return false;
    if (YAML_DATE_REGEXP.exec(data) !== null) return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null) throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 6e4;
      if (match[9] === "-") delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta) date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  timestamp = new Type2("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge) return merge;
  hasRequiredMerge = 1;
  const Type2 = requireType();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  merge = new Type2("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary) return binary;
  hasRequiredBinary = 1;
  const Type2 = requireType();
  const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
  function resolveYamlBinary(data) {
    if (data === null) return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64) continue;
      if (code < 0) return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0; idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  binary = new Type2("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap) return omap;
  hasRequiredOmap = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null) return true;
    const objectKeys = {};
    const object = data;
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]") return false;
      let pairKey;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey) pairHasKey = true;
          else return false;
        }
      }
      if (!pairHasKey) return false;
      if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
      Object.defineProperty(objectKeys, pairKey, { value: true });
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  omap = new Type2("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs) return pairs;
  hasRequiredPairs = 1;
  const Type2 = requireType();
  const _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null) return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]") return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1) return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null) return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  pairs = new Type2("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null) return true;
    const object = data;
    for (const key in object) {
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null) return false;
      }
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  set = new Type2("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  return set;
}
var _default;
var hasRequired_default;
function require_default() {
  if (hasRequired_default) return _default;
  hasRequired_default = 1;
  _default = requireCore().extend({
    implicit: [
      requireTimestamp(),
      requireMerge()
    ],
    explicit: [
      requireBinary(),
      requireOmap(),
      requirePairs(),
      requireSet()
    ]
  });
  return _default;
}
var hasRequiredLoader;
function requireLoader() {
  if (hasRequiredLoader) return loader;
  hasRequiredLoader = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const makeSnippet = requireSnippet();
  const DEFAULT_SCHEMA2 = require_default();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CONTEXT_FLOW_IN = 1;
  const CONTEXT_FLOW_OUT = 2;
  const CONTEXT_BLOCK_IN = 3;
  const CONTEXT_BLOCK_OUT = 4;
  const CHOMPING_CLIP = 1;
  const CHOMPING_STRIP = 2;
  const CHOMPING_KEEP = 3;
  const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c) {
    return c === 10 || c === 13;
  }
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    const lc = c | 32;
    if (lc >= 97 && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120) {
      return 2;
    }
    if (c === 117) {
      return 4;
    }
    if (c === 85) {
      return 8;
    }
    return 0;
  }
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    return -1;
  }
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return "\n";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "\x85";
      case 95:
        return "\xA0";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c) {
    if (c <= 65535) {
      return String.fromCharCode(c);
    }
    return String.fromCharCode(
      (c - 65536 >> 10) + 55296,
      (c - 65536 & 1023) + 56320
    );
  }
  function setProperty(object, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key] = value;
    }
  }
  const simpleEscapeCheck = new Array(256);
  const simpleEscapeMap = new Array(256);
  for (let i = 0; i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.totalMergeKeys = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      // omit trailing \0
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException2(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name)) {
        transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
      }
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0) return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name)) {
        parent[name] = transaction[name];
      }
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) {
        state.anchorMap[names[index]] = entry.value;
      } else {
        delete state.anchorMap[names[index]];
      }
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  const directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) {
        for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  function chargeMergeWork(state) {
    state.totalMergeKeys++;
    if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) {
      throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common2.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    chargeMergeWork(state);
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
      const key = sourceKeys[index];
      chargeMergeWork(state);
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        if (valueNode.length > 100) {
          throwError(state, "abnormal merge sequence size");
        }
        for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) {
        return true;
      }
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1) {
      state.result += " ";
    } else if (count > 1) {
      state.result += common2.repeat("\n", count - 1);
    }
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          break;
        }
      } else if (ch === 35) {
        const preceding = state.input.charCodeAt(state.position - 1);
        if (isWsOrEol(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
        break;
      } else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (; hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (isWhiteSpace(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (isWhiteSpace(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!isEol(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) {
        throwError(state, "missing indentation for block scalar");
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += "\n";
          }
        }
        break;
      }
      if (folding) {
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common2.repeat("\n", emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common2.repeat("\n", emptyLines);
        }
      } else {
        state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      const following = state.input.charCodeAt(state.position + 1);
      if (!isWsOrEol(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33) return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    let _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38) return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42) return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type2;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) {
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    }
    state.depth += 1;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
          break;
        }
        if (!readTagProperty(state) && !readAnchorProperty(state)) {
          break;
        }
        if (propertyStart === null) {
          propertyStart = propertyState;
        }
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
            state,
            propertyStart,
            propertyStart.position - propertyStart.lineStart,
            flowIndent
          )) {
            hasContent = true;
          } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result);
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
        type2 = state.implicitTypes[typeIndex];
        if (type2.resolve(state.result)) {
          state.result = type2.construct(state.result);
          state.tag = type2.tag;
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type2 = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type2 = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type2 = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type2) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type2.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
      }
      if (!type2.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type2.construct(state.result, state.tag);
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch)) break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0) readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    }
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += "\n";
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\0");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\0";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  function loadAll2(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (let index = 0, length = documents.length; index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  function load2(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return void 0;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException2("expected a single document in the stream, but found more");
  }
  loader.loadAll = loadAll2;
  loader.load = load2;
  return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
  if (hasRequiredDumper) return dumper;
  hasRequiredDumper = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const DEFAULT_SCHEMA2 = require_default();
  const _toString = Object.prototype.toString;
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CHAR_BOM = 65279;
  const CHAR_TAB = 9;
  const CHAR_LINE_FEED = 10;
  const CHAR_CARRIAGE_RETURN = 13;
  const CHAR_SPACE = 32;
  const CHAR_EXCLAMATION = 33;
  const CHAR_DOUBLE_QUOTE = 34;
  const CHAR_SHARP = 35;
  const CHAR_PERCENT = 37;
  const CHAR_AMPERSAND = 38;
  const CHAR_SINGLE_QUOTE = 39;
  const CHAR_ASTERISK = 42;
  const CHAR_COMMA = 44;
  const CHAR_MINUS = 45;
  const CHAR_COLON = 58;
  const CHAR_EQUALS = 61;
  const CHAR_GREATER_THAN = 62;
  const CHAR_QUESTION = 63;
  const CHAR_COMMERCIAL_AT = 64;
  const CHAR_LEFT_SQUARE_BRACKET = 91;
  const CHAR_RIGHT_SQUARE_BRACKET = 93;
  const CHAR_GRAVE_ACCENT = 96;
  const CHAR_LEFT_CURLY_BRACKET = 123;
  const CHAR_VERTICAL_LINE = 124;
  const CHAR_RIGHT_CURLY_BRACKET = 125;
  const ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = '\\"';
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  const DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema2, map2) {
    if (map2 === null) return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length; index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      const type2 = schema2.compiledTypeMap["fallback"][tag];
      if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
        style = type2.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common2.repeat("0", length - string.length) + string;
  }
  const QUOTING_TYPE_SINGLE = 1;
  const QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    const ind = common2.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf("\n", position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== "\n") result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return "\n" + common2.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str2) {
    for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
      const type2 = state.implicitTypes[index];
      if (type2.resolve(str2)) {
        return true;
      }
    }
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && // - b-char
    c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (
      // ns-plain-safe
      (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
      c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
      c !== CHAR_SHARP && // false on '#'
      !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
      isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
      prev === CHAR_COLON && cIsNsChar
    );
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
    c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  function needIndentIndicator(string) {
    const leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  const STYLE_PLAIN = 1;
  const STYLE_SINGLE = 2;
  const STYLE_LITERAL = 3;
  const STYLE_FOLDED = 4;
  const STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
            i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = (function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || // No block styles in flow mode.
      state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      switch (chooseScalarStyle(
        string,
        singleLineOnly,
        state.indent,
        lineWidth,
        testAmbiguity,
        state.quotingType,
        state.forceQuotes && !iskey,
        inblock
      )) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string) + '"';
        default:
          throw new YAMLException2("impossible error: invalid scalar style");
      }
    })();
  }
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === "\n";
    const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
    const chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + "\n";
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = (function() {
      let nextLF = string.indexOf("\n");
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    })();
    let prevMoreIndented = string[0] === "\n" || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ") return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += "\n" + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += "\n";
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536) result += string[i + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "") pairBuffer += ", ";
      if (state.condenseFlow) pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024) pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException2("sortKeys must be a boolean or a function");
    }
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length; index < length; index += 1) {
      const type2 = typeList[index];
      if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
        if (explicit) {
          if (type2.multi && type2.representName) {
            state.tag = type2.representName(object);
          } else {
            state.tag = type2.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type2.represent) {
          const style = state.styleMap[type2.tag] || type2.defaultStyle;
          let _result;
          if (_toString.call(type2.represent) === "[object Function]") {
            _result = type2.represent(object, style);
          } else if (_hasOwnProperty.call(type2.represent, style)) {
            _result = type2.represent[style](object, style);
          } else {
            throw new YAMLException2("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    const type2 = _toString.call(state.dump);
    const inblock = block;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type2 === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type2 === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid) return false;
        throw new YAMLException2("unacceptable kind of an object to dump " + type2);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(
          state.tag[0] === "!" ? state.tag.slice(1) : state.tag
        ).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0; index < length; index += 1) {
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects.push(object);
        if (Array.isArray(object)) {
          for (let i = 0, length = object.length; i < length; i += 1) {
            inspectNode(object[i], objects, duplicatesIndexes);
          }
        } else {
          const objectKeyList = Object.keys(object);
          for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
            inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
          }
        }
      }
    }
  }
  function dump2(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs) getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
    return "";
  }
  dumper.dump = dump2;
  return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
  if (hasRequiredJsYaml) return jsYaml;
  hasRequiredJsYaml = 1;
  const loader2 = requireLoader();
  const dumper2 = requireDumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  jsYaml.Type = requireType();
  jsYaml.Schema = requireSchema();
  jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
  jsYaml.JSON_SCHEMA = requireJson();
  jsYaml.CORE_SCHEMA = requireCore();
  jsYaml.DEFAULT_SCHEMA = require_default();
  jsYaml.load = loader2.load;
  jsYaml.loadAll = loader2.loadAll;
  jsYaml.dump = dumper2.dump;
  jsYaml.YAMLException = requireException();
  jsYaml.types = {
    binary: requireBinary(),
    float: requireFloat(),
    map: requireMap(),
    null: require_null(),
    pairs: requirePairs(),
    set: requireSet(),
    timestamp: requireTimestamp(),
    bool: requireBool(),
    int: requireInt(),
    merge: requireMerge(),
    omap: requireOmap(),
    seq: requireSeq(),
    str: requireStr()
  };
  jsYaml.safeLoad = renamed("safeLoad", "load");
  jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
  jsYaml.safeDump = renamed("safeDump", "dump");
  return jsYaml;
}
var jsYamlExports = requireJsYaml();
var yaml = /* @__PURE__ */ getDefaultExportFromCjs(jsYamlExports);
var {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
} = yaml;

// src/core/vault.ts
function normalizeVaultPath(path2) {
  return path2.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

// src/core/parse.ts
var TYPE_ALIASES = {
  // entity
  entity: "entity",
  entities: "entity",
  \u5B9E\u4F53: "entity",
  \u4EBA\u7269: "entity",
  \u7EC4\u7EC7: "entity",
  person: "entity",
  org: "entity",
  organization: "entity",
  product: "entity",
  tool: "entity",
  \u4EA7\u54C1: "entity",
  \u5DE5\u5177: "entity",
  \u9879\u76EE: "entity",
  project: "entity",
  // concept
  concept: "concept",
  concepts: "concept",
  \u6982\u5FF5: "concept",
  \u672F\u8BED: "concept",
  term: "concept",
  topic: "concept",
  \u4E3B\u9898: "concept",
  theory: "concept",
  \u7406\u8BBA: "concept",
  // source
  source: "source",
  sources: "source",
  \u8D44\u6599: "source",
  \u6765\u6E90: "source",
  reference: "source",
  paper: "source",
  \u8BBA\u6587: "source",
  \u6587\u732E: "source",
  book: "source",
  \u4E66\u7C4D: "source",
  article: "source",
  \u6587\u7AE0: "source",
  video: "source",
  \u89C6\u9891: "source",
  clip: "source",
  \u526A\u85CF: "source",
  // synthesis
  synthesis: "synthesis",
  \u7EFC\u8FF0: "synthesis",
  \u7EFC\u5408: "synthesis",
  summary: "synthesis",
  \u603B\u7ED3: "synthesis",
  \u6C47\u603B: "synthesis",
  digest: "synthesis",
  \u6458\u8981: "synthesis",
  // query
  query: "query",
  queries: "query",
  \u67E5\u8BE2: "query",
  research: "query",
  \u7814\u7A76: "query",
  \u68C0\u7D22: "query",
  // comparison
  comparison: "comparison",
  compare: "comparison",
  \u6BD4\u8F83: "comparison",
  \u5BF9\u6BD4: "comparison",
  contrast: "comparison",
  \u5BF9\u7167: "comparison",
  // finding
  finding: "finding",
  findings: "finding",
  \u53D1\u73B0: "finding",
  \u7ED3\u8BBA: "finding",
  result: "finding",
  \u7ED3\u679C: "finding",
  insight: "finding",
  \u6D1E\u5BDF: "finding",
  // thesis
  thesis: "thesis",
  \u8BBA\u70B9: "thesis",
  \u4E3B\u5F20: "thesis",
  claim: "thesis",
  \u89C2\u70B9: "thesis",
  hypothesis: "thesis",
  \u5047\u8BBE: "thesis",
  // methodology
  methodology: "methodology",
  method: "methodology",
  \u65B9\u6CD5\u8BBA: "methodology",
  \u65B9\u6CD5: "methodology",
  process: "methodology",
  \u6D41\u7A0B: "methodology",
  \u6B65\u9AA4: "methodology",
  // overview / structural
  overview: "overview",
  \u6982\u8FF0: "overview",
  index: "overview",
  \u7D22\u5F15: "overview",
  moc: "overview",
  \u76EE\u5F55: "overview",
  \u5BFC\u822A: "overview",
  hub: "overview"
};
function normalizePageType(raw) {
  if (typeof raw !== "string") return "other";
  const key = raw.trim().toLowerCase();
  if (!key) return "other";
  return TYPE_ALIASES[key] ?? (TYPE_ALIASES[raw.trim()] || "other");
}
var STRUCTURAL_SLUGS = /* @__PURE__ */ new Set([
  "index",
  "overview",
  "log",
  "purpose",
  "schema",
  "home",
  "readme",
  "moc",
  "inbox",
  "\u7D22\u5F15",
  "\u6982\u8FF0",
  "\u76EE\u5F55",
  "\u9996\u9875"
]);
function isStructuralSlug(basename) {
  const slug = basename.trim().toLowerCase().replace(/\.md$/, "");
  if (STRUCTURAL_SLUGS.has(slug)) return true;
  return /^(index|overview|log|purpose|schema|moc)\b/.test(slug);
}
function normalizeSourceKey(raw) {
  let value = raw.trim();
  if (!value) return "";
  value = value.replace(/^\[\[|\]\]$/g, "");
  value = value.split("|")[0];
  value = value.split("#")[0];
  value = value.replace(/\\/g, "/");
  value = value.split("/").pop() ?? value;
  value = value.replace(/\.(md|pdf|docx?|txt|html?|epub|mobi|pptx?|xlsx?)$/i, "");
  value = value.replace(/\s+/g, " ").trim().toLowerCase();
  return value;
}
var FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
function splitFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: content, raw: "" };
  let data = {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
    }
  } catch {
    data = {};
  }
  return { data, body: content.slice(match[0].length), raw: match[1] };
}
function toStringArray(value) {
  if (value === null || value === void 0) return [];
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((part) => part.trim().replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item.trim());
      else if (typeof item === "number") out.push(String(item));
    }
    return out.filter(Boolean);
  }
  return [];
}
var WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;
function stripCode(content) {
  return content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}
function extractWikilinks(content) {
  const links = [];
  const scannable = stripCode(content);
  const re = new RegExp(WIKILINK_RE.source, "g");
  let match;
  while ((match = re.exec(scannable)) !== null) {
    const inner = match[1];
    const target = inner.split("|")[0].split("#")[0].trim();
    if (target) links.push(target);
  }
  return links;
}
function normalizeRelatedEntry(raw) {
  let value = raw.trim().replace(/^\[\[|\]\]$/g, "");
  value = value.split("|")[0].split("#")[0].replace(/\\/g, "/");
  return (value.split("/").pop() ?? value).replace(/\.md$/i, "").trim();
}
function parseNote(path2, content) {
  const normalizedPath = normalizeVaultPath(path2);
  const fileBase = normalizedPath.split("/").pop() ?? normalizedPath;
  const basename = fileBase.replace(/\.md$/i, "");
  const rawId = normalizedPath.replace(/\.md$/i, "");
  const id = rawId.toLowerCase();
  const { data, body } = splitFrontmatter(content);
  const rawType = typeof data.type === "string" ? data.type.trim() : typeof data.Type === "string" ? String(data.Type).trim() : "";
  const type2 = normalizePageType(rawType);
  const sources = toStringArray(data.sources ?? data.source).map(normalizeSourceKey).filter(Boolean);
  const tags = toStringArray(data.tags ?? data.tag).map((tag) => tag.replace(/^#/, "").trim());
  const aliases = toStringArray(data.aliases ?? data.alias);
  const related = toStringArray(data.related).map(normalizeRelatedEntry).filter(Boolean);
  const links = Array.from(/* @__PURE__ */ new Set([...extractWikilinks(body), ...extractWikilinks(content), ...related]));
  const title = pickTitle(data.title, body, basename);
  const isStructural = type2 === "overview" || isStructuralSlug(basename);
  return {
    path: normalizedPath,
    id,
    rawId,
    basename,
    title,
    rawType,
    type: type2,
    sources: Array.from(new Set(sources)),
    tags,
    aliases,
    links,
    isStructural
  };
}
function pickTitle(frontmatterTitle, body, basename) {
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  if (typeof frontmatterTitle === "number") return String(frontmatterTitle);
  const heading = body.match(/^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  if (heading) return heading[1].trim();
  return basename.replace(/[-_]+/g, " ").trim() || basename;
}

// src/core/relevance.ts
function buildAdjacency(nodes, links) {
  const outLinks = /* @__PURE__ */ new Map();
  const inLinks = /* @__PURE__ */ new Map();
  const neighbors = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    outLinks.set(node.id, /* @__PURE__ */ new Set());
    inLinks.set(node.id, /* @__PURE__ */ new Set());
    neighbors.set(node.id, /* @__PURE__ */ new Set());
  }
  for (const link of links) {
    const { source, target } = link;
    if (source === target) continue;
    const out = outLinks.get(source);
    const inbound = inLinks.get(target);
    if (!out || !inbound) continue;
    out.add(target);
    inbound.add(source);
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  }
  return { outLinks, inLinks, neighbors };
}
function createRelevanceContext(nodes, links) {
  const nodeIndex = /* @__PURE__ */ new Map();
  for (const node of nodes) nodeIndex.set(node.id, node);
  const { outLinks, inLinks, neighbors } = buildAdjacency(nodes, links);
  return { nodes: nodeIndex, outLinks, inLinks, neighbors };
}
function resolveWeights(weights) {
  if (!weights) return DEFAULT_RELEVANCE_WEIGHTS;
  return {
    directLink: weights.directLink ?? DEFAULT_RELEVANCE_WEIGHTS.directLink,
    sourceOverlap: weights.sourceOverlap ?? DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
    commonNeighbor: weights.commonNeighbor ?? DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
    coCitation: weights.coCitation ?? DEFAULT_RELEVANCE_WEIGHTS.coCitation
  };
}
function saturate(count) {
  if (!(count > 0)) return 0;
  return count / (1 + count);
}
function coCitationCount(a, b, ctx) {
  const inboundA = ctx.inLinks.get(a.id);
  const inboundB = ctx.inLinks.get(b.id);
  if (!inboundA || !inboundB || inboundA.size === 0 || inboundB.size === 0) return 0;
  const [small, large] = inboundA.size <= inboundB.size ? [inboundA, inboundB] : [inboundB, inboundA];
  let shared = 0;
  for (const id of small) if (large.has(id)) shared += 1;
  return shared;
}
function countSharedSources(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const aSources = new Set(a);
  let shared = 0;
  for (const source of b) {
    if (aSources.has(source)) shared += 1;
  }
  return shared;
}
function adamicAdarSum(a, b, ctx) {
  const neighborsA = ctx.neighbors.get(a.id);
  const neighborsB = ctx.neighbors.get(b.id);
  if (!neighborsA || !neighborsB) return 0;
  if (neighborsA.size === 0 || neighborsB.size === 0) return 0;
  const aIsSmaller = neighborsA.size <= neighborsB.size;
  const small = aIsSmaller ? neighborsA : neighborsB;
  const large = aIsSmaller ? neighborsB : neighborsA;
  let sum = 0;
  for (const neighborId of small) {
    if (!large.has(neighborId)) continue;
    const degree = ctx.neighbors.get(neighborId)?.size ?? 0;
    sum += 1 / Math.log(Math.max(degree, 2));
  }
  return sum;
}
function zeroBreakdown() {
  return { directLink: 0, sourceOverlap: 0, adamicAdar: 0, coCitation: 0, total: 0 };
}
function computeRelevance(a, b, ctx, weights) {
  if (a.id === b.id) return zeroBreakdown();
  const w = resolveWeights(weights);
  const forward = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
  const backward = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
  const directLink = (forward + backward) / 2 * w.directLink;
  const sourceOverlap = saturate(countSharedSources(a.sources, b.sources)) * w.sourceOverlap;
  const adamicAdar = saturate(adamicAdarSum(a, b, ctx)) * w.commonNeighbor;
  const coCitation = saturate(coCitationCount(a, b, ctx)) * w.coCitation;
  return {
    directLink,
    sourceOverlap,
    adamicAdar,
    coCitation,
    total: directLink + sourceOverlap + adamicAdar + coCitation
  };
}

// src/core/graph-builder.ts
var DEFAULT_CONCURRENCY = 16;
var DEFAULT_MAX_FILE_BYTES = 2e6;
var IGNORED_FOLDER_PREFIXES = [".trash/", ".git/"];
var DEFAULT_HIDDEN_TYPES = /* @__PURE__ */ new Set(["query"]);
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function clampConcurrency(value, fallback) {
  if (value === void 0 || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
function normalizeLinkKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
function spacedLinkKey(value) {
  return value.trim().toLowerCase().replace(/-/g, " ");
}
function utf8Length(codePoint) {
  if (codePoint < 128) return 1;
  if (codePoint < 2048) return 2;
  if (codePoint < 65536) return 3;
  return 4;
}
function exceedsByteBudget(content, maxBytes) {
  if (content.length > maxBytes) return true;
  if (content.length * 3 <= maxBytes) return false;
  let bytes = 0;
  for (const char of content) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) return true;
  }
  return false;
}
async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  const workerCount = Math.min(clampConcurrency(limit, 1), values.length);
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
function isExcludedPath(path2, excludeFolders, configDir) {
  const configPrefix = configDir.endsWith("/") ? configDir : `${configDir}/`;
  if (path2.startsWith(configPrefix)) return true;
  if (IGNORED_FOLDER_PREFIXES.some((prefix) => path2.startsWith(prefix))) return true;
  return excludeFolders.some((prefix) => path2.startsWith(prefix));
}
async function discoverMarkdownFiles(vault, excludeFolders, workingFolder) {
  let listed;
  try {
    listed = await vault.listMarkdownFiles();
  } catch {
    return [];
  }
  const configDir = vault.configDir();
  const unique = /* @__PURE__ */ new Set();
  for (const raw of listed) {
    const path2 = normalizeVaultPath(raw);
    if (!/\.md$/i.test(path2)) continue;
    if (!isInWorkspace(path2, workingFolder, excludeFolders)) continue;
    if (isExcludedPath(path2, [], configDir)) continue;
    unique.add(path2);
  }
  return [...unique].sort(compareStrings);
}
async function loadNotes(vault, options = {}) {
  const excludeFolders = (options.excludeFolders ?? []).map((prefix) => normalizeVaultPath(prefix)).filter(Boolean);
  const workingFolder = normalizeVaultPath(options.workingFolder ?? "");
  const hiddenTypes = options.hiddenTypes ?? DEFAULT_HIDDEN_TYPES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const concurrency = clampConcurrency(options.concurrency, DEFAULT_CONCURRENCY);
  const { onProgress } = options;
  const paths = await discoverMarkdownFiles(vault, excludeFolders, workingFolder);
  const total = paths.length;
  let done = 0;
  const parsed = await mapWithConcurrency(paths, concurrency, async (path2) => {
    let note = null;
    try {
      const content = await vault.read(path2);
      if (!exceedsByteBudget(content, maxFileBytes)) note = parseNote(path2, content);
    } catch {
      note = null;
    }
    done += 1;
    onProgress?.(done, total);
    return note;
  });
  const notes = parsed.filter((note) => note !== null);
  if (hiddenTypes.size === 0) return notes;
  return notes.filter((note) => !hiddenTypes.has(note.type));
}
function buildLinkIndex(notes) {
  const byKey = /* @__PURE__ */ new Map();
  const ids = [];
  const seenIds = /* @__PURE__ */ new Set();
  const idOf = (note) => (note.id || note.rawId).toLowerCase();
  const claim = (key, id) => {
    if (key && !byKey.has(key)) byKey.set(key, id);
  };
  for (const note of notes) {
    const id = idOf(note);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
    claim(id, id);
  }
  for (const id of ids) {
    claim(normalizeLinkKey(id), id);
    claim(spacedLinkKey(id), id);
  }
  for (const note of notes) {
    const id = idOf(note);
    const basename = note.basename.replace(/\.md$/i, "").trim().toLowerCase();
    claim(basename, id);
    claim(normalizeLinkKey(basename), id);
    claim(spacedLinkKey(basename), id);
  }
  for (const note of notes) {
    const id = idOf(note);
    for (const alias of note.aliases) {
      const key = alias.trim().replace(/^\.\//, "").toLowerCase();
      if (!key) continue;
      claim(key, id);
      claim(normalizeLinkKey(key), id);
    }
  }
  return Object.freeze({ byKey, ids: Object.freeze(ids) });
}
function resolveLinkTarget(raw, index) {
  const target = raw.trim().split("|")[0].split("#")[0].trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!target) return null;
  const lower = target.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const candidates = [];
  if (lower.endsWith(".md")) candidates.push(lower.slice(0, -3));
  candidates.push(
    lower,
    // exact id, basename or alias
    basename,
    // `[[some/deep/Note Two]]`
    normalizeLinkKey(lower),
    // spaces -> hyphens
    spacedLinkKey(lower),
    // hyphens -> spaces
    normalizeLinkKey(basename),
    spacedLinkKey(basename)
  );
  const tried = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (!candidate || tried.has(candidate)) continue;
    tried.add(candidate);
    const hit = index.byKey.get(candidate);
    if (hit !== void 0) return hit;
  }
  return null;
}
function sharedSourceKeys(a, b) {
  const inB = new Set(b.sources);
  const shared = /* @__PURE__ */ new Set();
  for (const source of a.sources) {
    if (inB.has(source)) shared.add(source);
  }
  return [...shared].sort(compareStrings);
}
function countCommonNeighbors(a, b, ctx) {
  const neighborsA = ctx.neighbors.get(a);
  const neighborsB = ctx.neighbors.get(b);
  if (!neighborsA || !neighborsB) return 0;
  const [small, large] = neighborsA.size <= neighborsB.size ? [neighborsA, neighborsB] : [neighborsB, neighborsA];
  let shared = 0;
  for (const id of small) {
    if (large.has(id)) shared += 1;
  }
  return shared;
}
async function listVaultFolders(vault) {
  let listed;
  try {
    listed = await vault.listMarkdownFiles();
  } catch {
    return [];
  }
  const configDir = vault.configDir();
  const direct = /* @__PURE__ */ new Map();
  const present = /* @__PURE__ */ new Set();
  for (const raw of listed) {
    const path2 = normalizeVaultPath(raw);
    if (!/\.md$/i.test(path2)) continue;
    if (isExcludedPath(path2, [], configDir)) continue;
    const parts = path2.split("/");
    parts.pop();
    const folder = parts.join("/");
    direct.set(folder, (direct.get(folder) ?? 0) + 1);
    for (let depth = 0; depth <= parts.length; depth += 1) {
      present.add(parts.slice(0, depth).join("/"));
    }
  }
  const countOf = (folder) => {
    if (folder === "") return direct.get("") ?? 0;
    let total = 0;
    for (const [path2, count] of direct) {
      if (path2 === folder || path2.startsWith(`${folder}/`)) total += count;
    }
    return total;
  };
  if (present.size === 0) return [];
  return [
    { path: "", count: countOf("") },
    ...[...present].filter((folder) => folder !== "").sort(compareStrings).map((folder) => ({ path: folder, count: countOf(folder) }))
  ];
}
async function buildWikiGraph(options) {
  const [notes, folders] = await Promise.all([
    loadNotes(options.vault, options),
    listVaultFolders(options.vault)
  ]);
  if (notes.length === 0) {
    return folders.length === 0 ? EMPTY_GRAPH : Object.freeze({ ...EMPTY_GRAPH, folders: Object.freeze(folders) });
  }
  const index = buildLinkIndex(notes);
  const directedLinks = [];
  const directedKeys = /* @__PURE__ */ new Set();
  const outCounts = /* @__PURE__ */ new Map();
  const inCounts = /* @__PURE__ */ new Map();
  for (const note of notes) {
    const targets = /* @__PURE__ */ new Set();
    for (const raw of note.links) {
      const targetId = resolveLinkTarget(raw, index);
      if (targetId === null || targetId === note.id) continue;
      if (targets.has(targetId)) continue;
      targets.add(targetId);
      directedLinks.push({ source: note.id, target: targetId });
      directedKeys.add(`${note.id}\0${targetId}`);
      outCounts.set(note.id, (outCounts.get(note.id) ?? 0) + 1);
      inCounts.set(targetId, (inCounts.get(targetId) ?? 0) + 1);
    }
  }
  const preliminary = notes.map((note) => {
    const inLinks = inCounts.get(note.id) ?? 0;
    const outLinks = outCounts.get(note.id) ?? 0;
    return Object.freeze({
      id: note.id,
      label: note.title,
      type: note.type,
      rawType: note.rawType,
      path: normalizeVaultPath(note.path),
      linkCount: inLinks + outLinks,
      inLinks,
      outLinks,
      community: 0,
      sources: Object.freeze([...note.sources]),
      tags: Object.freeze([...note.tags]),
      isStructural: note.isStructural
    });
  });
  const nodeById = new Map(preliminary.map((node) => [node.id, node]));
  const ctx = createRelevanceContext(preliminary, directedLinks);
  const pairs2 = [];
  const seenPairs = /* @__PURE__ */ new Set();
  for (const link of directedLinks) {
    const pair = compareStrings(link.source, link.target) <= 0 ? [link.source, link.target] : [link.target, link.source];
    const [a, b] = pair;
    const key = `${a}\0${b}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    pairs2.push(pair);
  }
  const edges = [];
  for (const [a, b] of pairs2) {
    const nodeA = nodeById.get(a);
    const nodeB = nodeById.get(b);
    if (!nodeA || !nodeB) continue;
    const signals = computeRelevance(nodeA, nodeB, ctx, options.weights);
    edges.push(
      Object.freeze({
        source: a,
        target: b,
        weight: signals.total,
        signals: Object.freeze({ ...signals }),
        hasDirectLink: directedKeys.has(`${a}\0${b}`) || directedKeys.has(`${b}\0${a}`),
        sharedSources: Object.freeze(sharedSourceKeys(nodeA, nodeB)),
        commonNeighbors: countCommonNeighbors(a, b, ctx)
      })
    );
  }
  const { assignments, communities } = deriveCommunities(
    preliminary.map((node) => ({ id: node.id, label: node.label, linkCount: node.linkCount })),
    edges.map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight })),
    {
      resolution: clampResolution(options.resolution),
      ...options.previousCommunities ? { previousCommunities: options.previousCommunities } : {}
    }
  );
  const nodes = preliminary.map(
    (node) => Object.freeze({ ...node, community: assignments.get(node.id) ?? 0 })
  );
  const sortedNodes = [...nodes].sort(
    (a, b) => b.linkCount - a.linkCount || compareStrings(a.id, b.id)
  );
  const sortedEdges = [...edges].sort(
    (a, b) => b.weight - a.weight || compareStrings(a.source, b.source) || compareStrings(a.target, b.target)
  );
  const nodeIndex = /* @__PURE__ */ new Map();
  notes.forEach((note, position) => {
    const node = nodes[position];
    if (!node) return;
    if (!nodeIndex.has(note.id)) nodeIndex.set(note.id, node);
    if (!nodeIndex.has(note.rawId)) nodeIndex.set(note.rawId, node);
  });
  return Object.freeze({
    nodes: Object.freeze(sortedNodes),
    edges: Object.freeze(sortedEdges),
    communities: Object.freeze(communities),
    nodeIndex,
    folders: Object.freeze(folders),
    builtAt: Date.now()
  });
}

// scripts/stability-eval.ts
var vaultRoot = import_node_path.default.resolve(process.argv[2] ?? import_node_path.default.join(process.cwd(), "..", "\u63D2\u4EF6\u5F00\u53D1"));
var ORDER_TRIALS = Number(process.env.EVAL_TRIALS ?? 12);
var DROP_TRIALS = Number(process.env.EVAL_DROP_TRIALS ?? 12);
var JITTER_STEP = Number(process.env.EVAL_JITTER ?? 0.1);
var NodeVault = class {
  configDir() {
    return ".obsidian";
  }
  async listMarkdownFiles() {
    const out = [];
    const walk = (dir) => {
      for (const entry of import_node_fs.default.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = import_node_path.default.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith(".md")) {
          out.push(import_node_path.default.relative(vaultRoot, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(vaultRoot);
    return out.sort();
  }
  async read(relative) {
    return import_node_fs.default.readFileSync(import_node_path.default.join(vaultRoot, relative), "utf8");
  }
  async exists(relative) {
    return import_node_fs.default.existsSync(import_node_path.default.join(vaultRoot, relative));
  }
};
function mulberry322(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function adjustedRand(a, b) {
  const ids = [...a.keys()].filter((id) => b.has(id));
  if (ids.length < 2) return 1;
  const cells = /* @__PURE__ */ new Map();
  const rows = /* @__PURE__ */ new Map();
  const cols = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const x = a.get(id);
    const y = b.get(id);
    const key = `${x}\0${y}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    rows.set(x, (rows.get(x) ?? 0) + 1);
    cols.set(y, (cols.get(y) ?? 0) + 1);
  }
  const choose2 = (n) => n * (n - 1) / 2;
  const sum = (values) => {
    let total2 = 0;
    for (const value of values) total2 += choose2(value);
    return total2;
  };
  const total = choose2(ids.length);
  const sumCells = sum(cells.values());
  const sumRows = sum(rows.values());
  const sumCols = sum(cols.values());
  const expected = total === 0 ? 0 : sumRows * sumCols / total;
  const maximum = 0.5 * (sumRows + sumCols);
  if (maximum === expected) return 1;
  return (sumCells - expected) / (maximum - expected);
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
function spread(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}
function report(label, values) {
  const sorted = [...values].sort((x, y) => x - y);
  console.log(
    `  ${label.padEnd(30)} mean ${mean(values).toFixed(3)}  sd ${spread(values).toFixed(3)}  min ${sorted[0].toFixed(3)}  max ${sorted[sorted.length - 1].toFixed(3)}`
  );
}
async function main() {
  const graph = await buildWikiGraph({ vault: new NodeVault() });
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    linkCount: node.linkCount
  }));
  const edges = graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight
  }));
  const baseline = deriveCommunities(nodes, edges);
  console.log(`vault: ${vaultRoot}`);
  console.log(
    `notes: ${graph.nodes.length}   links: ${graph.edges.length}   clusters: ${baseline.communities.length}
`
  );
  const random = mulberry322(20261009);
  const coreOf = (assignments) => {
    const byCommunity = /* @__PURE__ */ new Map();
    for (const [id, community] of assignments) {
      const members = byCommunity.get(community);
      if (members) members.push(id);
      else byCommunity.set(community, [id]);
    }
    const cores = /* @__PURE__ */ new Map();
    for (const [community, members] of byCommunity) {
      cores.set(community, [...members].sort()[0]);
    }
    return cores;
  };
  const baselineCores = coreOf(baseline.assignments);
  const coreAgreement = (assignments) => {
    const cores = coreOf(assignments);
    let same = 0;
    let total = 0;
    for (const [community, core2] of baselineCores) {
      const after = cores.get(community);
      if (after === void 0) continue;
      total += 1;
      if (after === core2) same += 1;
    }
    return total === 0 ? 1 : same / total;
  };
  const orderAris = [];
  const orderCores = [];
  for (let trial = 0; trial < ORDER_TRIALS; trial += 1) {
    const shuffled = [...nodes];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const result = deriveCommunities(shuffled, edges);
    orderAris.push(adjustedRand(baseline.assignments, result.assignments));
    orderCores.push(coreAgreement(result.assignments));
  }
  const dropAris = /* @__PURE__ */ new Map();
  for (const share of [0.01, 0.05]) {
    const values = [];
    for (let trial = 0; trial < DROP_TRIALS; trial += 1) {
      const dropped = /* @__PURE__ */ new Set();
      const count = Math.max(1, Math.round(edges.length * share));
      while (dropped.size < count) dropped.add(Math.floor(random() * edges.length));
      const kept = edges.filter((_edge, index) => !dropped.has(index));
      const result = deriveCommunities(nodes, kept);
      values.push(adjustedRand(baseline.assignments, result.assignments));
    }
    dropAris.set(`${(share * 100).toFixed(0)}% of links dropped`, values);
  }
  const jitterAris = [];
  for (const resolution of [1 - JITTER_STEP, 1 + JITTER_STEP]) {
    const result = deriveCommunities(nodes, edges, { resolution });
    jitterAris.push(adjustedRand(baseline.assignments, result.assignments));
  }
  console.log("=== ARI against the baseline partition (1.0 identical) ===");
  report("node order shuffled", orderAris);
  for (const [label, values] of dropAris) report(label, values);
  report(
    `resolution \xB1${JITTER_STEP}`,
    jitterAris
  );
  console.log(
    `
  clusters keeping their core note: order shuffles ${(mean(orderCores) * 100).toFixed(0)}%`
  );
  console.log("\n=== reading ===");
  console.log(
    "  Node order is the weakest lever of the three: the partition it produces is a\n  different valid answer, not a worse one. Link drops are what editing the vault\n  does, and the resolution row is the knob the clustering panel exposes."
  );
  void graph;
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
