// Shared asynchronous search picker used by reviewers, work-item links, and
// comment @mentions.

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/**
 * Builds a debounced search input and result list.
 *
 * `minChars: 0` loads suggestions on focus. `execute` lets a caller apply its
 * own busy/error boundary around a selected result without coupling the picker
 * to a particular view.
 */
export function createSearchPicker({
    prefix,
    id,
    labelText,
    placeholder,
    inputAriaLabel,
    resultsAriaLabel,
    minChars = 2,
    emptyText,
    failureText,
    onSearch,
    renderResult,
    onPick,
    execute = (operation) => Promise.resolve().then(operation),
    showInput = true,
    onResultsChanged,
    statusElement,
}) {
    const picker = element("div", `${prefix}-picker`);
    const label = element("label", `${prefix}-picker-label`, labelText);
    const input = element("input", `${prefix}-picker-input`);
    input.type = "search";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", inputAriaLabel);
    input.id = id;
    label.htmlFor = id;
    const results = element("ul", `${prefix}-picker-results`);
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", resultsAriaLabel);
    const status = statusElement || element("div", `${prefix}-picker-status`);
    status.setAttribute("aria-live", "polite");

    const note = (text, state) => {
        const row = element("li", `${prefix}-picker-empty`, text);
        row.setAttribute("role", "presentation");
        results.replaceChildren(row);
        status.textContent = text;
        onResultsChanged?.([], state, text);
    };
    let debounce;
    const clear = ({ preserveStatus = false } = {}) => {
        clearTimeout(debounce);
        searchToken += 1;
        input.value = "";
        results.replaceChildren();
        if (!preserveStatus) status.textContent = "";
        onResultsChanged?.([], "cleared", preserveStatus ? status.textContent : "");
    };

    let searchToken = 0;
    const search = async (rawQuery) => {
        const query = rawQuery.trim();
        const token = ++searchToken;
        if (query.length < minChars) {
            results.replaceChildren();
            status.textContent = "";
            onResultsChanged?.([], "idle", "");
            return;
        }
        note("Searching...", "loading");
        try {
            const found = await onSearch(query);
            if (token !== searchToken || !picker.isConnected) return;
            const items = found?.items || [];
            if (found?.error && !items.length) {
                note(found.error, "error");
                return;
            }
            if (!items.length) {
                note(emptyText, "empty");
                return;
            }
            results.replaceChildren();
            status.textContent = "";
            for (const [index, item] of items.entries()) {
                const listItem = element("li", `${prefix}-picker-result`);
                listItem.setAttribute("role", "none");
                const pick = element("button", `${prefix}-picker-add`);
                pick.id = `${id}-option-${index}`;
                pick.type = "button";
                if (!showInput) {
                    // Inline autocomplete keeps focus in the contenteditable. On
                    // macOS WebKit a clicked button does not reliably take focus,
                    // so prevent the blur before the click is delivered.
                    pick.tabIndex = -1;
                    pick.addEventListener("mousedown", (event) => event.preventDefault());
                }
                pick.setAttribute("role", "option");
                pick.setAttribute("aria-selected", "false");
                renderResult(pick, item);
                pick.addEventListener("click", () => {
                    Promise.resolve(execute(async () => {
                        await onPick(item);
                        clear();
                    })).catch((error) => note(error?.message || failureText, "error"));
                });
                listItem.append(pick);
                results.append(listItem);
            }
            onResultsChanged?.(items, "ready", "");
        } catch (error) {
            if (token !== searchToken || !picker.isConnected) return;
            note(error?.message || failureText, "error");
        }
    };

    const queueSearch = (rawQuery) => {
        clearTimeout(debounce);
        searchToken += 1;
        if (!showInput) {
            note("Searching...", "loading");
        }
        debounce = setTimeout(() => {
            if (picker.isConnected) search(rawQuery);
        }, 250);
    };
    if (showInput) {
        input.addEventListener("input", () => queueSearch(input.value));
    }
    if (showInput && minChars === 0) {
        input.addEventListener("focus", () => {
            if (!input.value.trim() && !results.childElementCount) search("");
        });
    }

    if (showInput) picker.append(label, input);
    picker.append(results);
    if (!statusElement) picker.append(status);
    return { picker, input, results, status, search, queueSearch, clear };
}
