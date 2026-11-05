import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as richText from "./ui/rich-text.mjs";

const source = "https://dev.azure.com/fabrikam/4e1c4e8f-0c57-4a25-9a4e-2e2c2f4d8a55/_apis/wit/attachments/06f5932c-aa2f-4545-9764-8546bec98914?fileName=image.png";
const nonce = "fixture-nonce";
const proxySource = `/api/attachment?${new URLSearchParams({ url: source, nonce })}`;

test("attachment DOM mechanism: sanitized work-item image keeps its remote source without a resolver", (t) => {
    const dom = new JSDOM("", { url: "http://127.0.0.1:12345/" });
    t.after(() => dom.window.close());
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.Node = dom.window.Node;
    richText.setImageUrlTransform?.(null);
    const node = richText.richTextElement("div", "", `<img src="${source}" onerror="alert(1)">`, { format: "html" });
    const image = node.querySelector("img");
    assert.equal(image.src, source);
    assert.equal(image.hasAttribute("onerror"), false);
    t.diagnostic(`actual sanitized DOM img.src=${image.src}; onerror removed=${!image.hasAttribute("onerror")}`);
});

test("attachment DOM regression: real richTextElement uses the resolver after sanitization", (t) => {
    const dom = new JSDOM("", { url: "http://127.0.0.1:12345/" });
    t.after(() => {
        richText.setImageUrlTransform?.(null);
        dom.window.close();
    });
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.Node = dom.window.Node;
    richText.setImageUrlTransform?.((value) => value === source ? proxySource : value);
    const node = richText.richTextElement("div", "", `<img src="${source}" onerror="alert(1)">`, { format: "html" });
    const image = node.querySelector("img");
    assert.equal(image.hasAttribute("onerror"), false);
    t.diagnostic(`actual DOM img.src=${image.src}`);
    assert.equal(image.getAttribute("src"), proxySource);
    assert.equal(new URL(image.src).origin, dom.window.location.origin);
});
