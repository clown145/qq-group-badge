import test from "node:test";
import assert from "node:assert/strict";

const inviteUrl = "https://qm.qq.com/q/test-cache";
const templateUrl = "https://template.test/badge.svg";
const avatarUrl = "https://images.test/avatar.svg";
const groupPayload = JSON.stringify({
  base_info: {
    groupinfo: {
      name: "Cache Test Group",
      groupcode: "123456789",
      memberCnt: 42,
      avatar: avatarUrl,
      description: "SVG cache smoke test",
      createtime: 1704067200,
      tags: ["cache", "svg", "worker"]
    },
    group_level: 4
  },
  card_info: {
    title: "Cache Test Group",
    subtitle: [{ item: "Smoke Test" }]
  }
});

const inviteHtml = `<!doctype html><html><head><script id="__NUXT_DATA__" type="application/json">${JSON.stringify([groupPayload])}</script></head><body></body></html>`;
const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" role="img"><text x="8" y="24">{{group_name}}</text><image href="{{avatar_data_url}}" x="180" y="4" width="40" height="40" /></svg>`;
const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="#0c7ff2" /></svg>`;

class MockR2Object {
  constructor(record) {
    this.record = record;
    this.size = record.bytes.byteLength;
    this.httpEtag = record.customMetadata?.etag || "mock-etag";
    this.body = new ReadableStream({
      start: (controller) => {
        controller.enqueue(record.bytes);
        controller.close();
      }
    });
  }

  async json() {
    return JSON.parse(new TextDecoder().decode(this.record.bytes));
  }

  writeHttpMetadata(headers) {
    const metadata = this.record.httpMetadata || {};
    if (metadata.contentType) {
      headers.set("content-type", metadata.contentType);
    }
    if (metadata.cacheControl) {
      headers.set("cache-control", metadata.cacheControl);
    }
  }
}

class MockR2Bucket {
  constructor() {
    this.store = new Map();
  }

  async put(key, value, options = {}) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.store.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {}
    });
  }

  async get(key) {
    const record = this.store.get(key);
    return record ? new MockR2Object(record) : null;
  }

  async head(key) {
    const record = this.store.get(key);
    return record ? { key, size: record.bytes.byteLength } : null;
  }

  async delete(key) {
    this.store.delete(key);
  }
}

test("svg cache serves miss then stale then hit", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const edgeCache = new Map();
  const bucket = new MockR2Bucket();
  const pending = [];

  globalThis.caches = {
    default: {
      async match(request) {
        const response = edgeCache.get(request.url);
        return response ? response.clone() : undefined;
      },
      async put(request, response) {
        edgeCache.set(request.url, response.clone());
      }
    }
  };

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === inviteUrl) {
      return new Response(inviteHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      });
    }

    if (url === templateUrl) {
      return new Response(templateSvg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8"
        }
      });
    }

    if (url === avatarUrl) {
      return new Response(avatarSvg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8"
        }
      });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };

  try {
    const worker = (await import("../.tmp-test-dist/index.js")).default;
    const env = {
      RENDER_BUCKET: bucket,
      CACHE_VERSION: "v1",
      SVG_CACHE_SOFT_TTL_SECONDS: "300",
      SVG_CACHE_HARD_TTL_SECONDS: "2592000"
    };
    const ctx = {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
      passThroughOnException() {}
    };

    async function requestBadge(version) {
      const response = await worker.fetch(
        new Request(
          `https://local.test/badge.svg?invite=${encodeURIComponent(inviteUrl)}&template=${encodeURIComponent(templateUrl)}&v=${version}`
        ),
        env,
        ctx
      );
      const body = await response.text();
      return {
        status: response.status,
        cache: response.headers.get("x-svg-cache"),
        body
      };
    }

    const first = await requestBadge(1);
    assert.equal(first.status, 200);
    assert.equal(first.cache, "miss");
    assert.match(first.body, /Cache Test Group/);
    assert.match(first.body, /data:image\//);

    const metaKey = [...bucket.store.keys()].find((key) => key.startsWith("svg-meta/"));
    assert.ok(metaKey, "expected svg meta object to be written");
    const meta = JSON.parse(new TextDecoder().decode(bucket.store.get(metaKey).bytes));
    meta.staleAfter = "2000-01-01T00:00:00.000Z";
    await bucket.put(metaKey, JSON.stringify(meta), {
      httpMetadata: {
        contentType: "application/json; charset=utf-8"
      }
    });

    const second = await requestBadge(2);
    assert.equal(second.status, 200);
    assert.equal(second.cache, "stale");

    await Promise.allSettled(pending.splice(0));

    const third = await requestBadge(3);
    assert.equal(third.status, 200);
    assert.equal(third.cache, "hit");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
