import * as nodeDefs from 'node-definitions';
import {fuzzy_match} from './vendor/fts_fuzzy_match';

export default class NodePool {
  constructor() {
    // Build pool
    this.pool = [];
    for (const k in nodeDefs) {
      this.pool.push({
        id: k,
        def: nodeDefs[k],
      });
    }

    // Sort alphabetically for now since we have no other relevance signals
    this.pool.sort((a, b) => {
      const sa = a.id.toUpperCase();
      const sb = b.id.toUpperCase();
      if (sa < sb) {
        return -1;
      }
      if (sa > sb) {
        return 1;
      }
      return 0;
    });
  }

  search(query) {
    const results = [];
    for (const node of this.pool) {
      const [hit, score, formattedStr] = fuzzy_match(query, node.id);
      if (hit) {
        results.push({
          score,
          formattedStr,
          node,
        });
      }
    }
    if (query !== '') { // TOOD: this is a hack, is query is empty, scoring is dumb
      results.sort((a, b) => (b.score - a.score));
    }
    console.log(results);
    return results;
  }
}
