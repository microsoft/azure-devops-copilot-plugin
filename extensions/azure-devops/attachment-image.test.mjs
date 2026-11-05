// Run with: node --test attachment-image.test.mjs
//
// Inline images in work item content are not inlined in the
// payload: they are attachments served from an endpoint that requires the same
// bearer token as the REST API. An <img> element cannot send that header, so
// rendering the stored URL directly leaves a broken image. The renderer hands
// each source to a resolver instead, and these tests pin the resolver contract
// without needing jsdom, since the helper only reads and writes attributes.
import assert from "node:assert/strict";
import test from "node:test";

import { rewriteImageSources, setImageUrlTransform } from "./ui/rich-text.mjs";

const ATTACHMENT =
    "https://dev.azure.com/contoso/4e1c4e8f-0c57-4a25-9a4e-2e2c2f4d8a55/_apis/wit/attachments/06f5932c-aa2f-4545-9764-8546bec98914?fileName=image.png";

function stubRoot(sources) {
    const images = sources.map((source) => ({
        source,
        getAttribute(name) {
            return name === "src" ? source : null;
        },
        setAttribute(name, value) {
            if (name === "src") {
                this.source = value;
            }
        },
    }));
    return { images, querySelectorAll: () => images };
}

test("rewrites a source the resolver changes", () => {
    setImageUrlTransform(() => "/api/attachment?url=proxied");
    const root = stubRoot([ATTACHMENT]);
    rewriteImageSources(root);
    assert.equal(root.images[0].source, "/api/attachment?url=proxied");
});

test("leaves a source the resolver returns unchanged", () => {
    setImageUrlTransform((source) => source);
    const root = stubRoot([ATTACHMENT]);
    rewriteImageSources(root);
    assert.equal(root.images[0].source, ATTACHMENT);
});

test("ignores an empty resolver result", () => {
    setImageUrlTransform(() => "");
    const root = stubRoot([ATTACHMENT]);
    rewriteImageSources(root);
    assert.equal(root.images[0].source, ATTACHMENT);
});

test("does nothing when no resolver is installed", () => {
    setImageUrlTransform(null);
    const root = stubRoot([ATTACHMENT]);
    rewriteImageSources(root);
    assert.equal(root.images[0].source, ATTACHMENT);
});
