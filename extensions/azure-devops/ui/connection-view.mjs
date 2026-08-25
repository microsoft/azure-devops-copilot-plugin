// The connection picker: where a user chooses the Azure DevOps organization the
// canvas reads from when the workspace has no Azure DevOps git remote to derive
// one from.
//
// Organization is the only required field. Azure DevOps answers work item and
// repository queries at organization scope, so asking for a project up front
// would demand more than the data needs. Pull requests are the exception —
// Azure DevOps has no organization-wide pull request route — so the form says
// so rather than letting a user discover it as an empty section.
//
// The panel is built once and then patched. Re-rendering it on every change
// would destroy the field the user is typing in, and would destroy the Save
// button between its mousedown and its mouseup, swallowing the click.

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function connectionLabel(connection) {
    return [connection.organization, connection.project].filter(Boolean).join(" / ");
}

function sourceLabel(connection) {
    if (connection.isRemote) return "from this repository's git remote";
    if (connection.source === "default") return "your default";
    if (connection.source === "input") return "opened directly";
    return "last used";
}

// Each field is "pick one you have, or type one we could not list". A custom
// combobox keeps that fallback while avoiding native datalist behavior, which
// varies by browser and hides the other choices after an exact match is picked.
//
// The value is committed on both `input` and `change`. `input` alone leaves Save
// disabled until the field is blurred, and a blur is exactly what clicking a
// disabled Save does not cause. `change` alone loses a value chosen from the
// datalist dropdown in engines that do not raise `input` for that.
//
// Neither is trusted at save time: read() takes the values straight off the
// fields, so what the user can see is what gets saved.
function field(id, label, hint, { onInput, onCommit }) {
    const wrapper = element("label", "connection-field");
    const control = element("div", "connection-combobox");
    const input = element("input", "connection-input");
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", id);
    const list = element("div", "connection-options");
    list.id = id;
    list.setAttribute("role", "listbox");
    list.hidden = true;
    control.append(input, list);
    const hintNode = element("span", "connection-field-hint", hint);
    wrapper.append(element("span", "connection-field-label", label), control, hintNode);

    let values = [];
    let visibleValues = [];
    let activeIndex = -1;
    let filtering = false;

    const close = () => {
        list.hidden = true;
        activeIndex = -1;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    };

    const setActive = (index) => {
        const options = [...list.querySelectorAll('[role="option"]')];
        if (!options.length) {
            activeIndex = -1;
            input.removeAttribute("aria-activedescendant");
            return;
        }
        activeIndex = (index + options.length) % options.length;
        for (const [optionIndex, option] of options.entries()) {
            option.setAttribute("aria-selected", String(optionIndex === activeIndex));
            option.classList.toggle("active", optionIndex === activeIndex);
        }
        input.setAttribute("aria-activedescendant", options[activeIndex].id);
        options[activeIndex].scrollIntoView?.({ block: "nearest" });
    };

    const choose = (value) => {
        input.value = value;
        onInput(value);
        close();
        onCommit?.(value);
    };

    const open = (filter) => {
        filtering = filter;
        const query = filter ? input.value.trim().toLocaleLowerCase() : "";
        visibleValues = values.filter((value) => !query || value.toLocaleLowerCase().includes(query));
        list.replaceChildren();
        for (const [index, value] of visibleValues.entries()) {
            const option = element("div", "connection-option", value);
            option.id = `${id}-option-${index}`;
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");
            option.addEventListener("mousedown", (event) => {
                event.preventDefault();
                choose(value);
            });
            list.append(option);
        }
        list.hidden = !visibleValues.length;
        input.setAttribute("aria-expanded", String(visibleValues.length > 0));
        activeIndex = -1;
        input.removeAttribute("aria-activedescendant");
    };

    input.addEventListener("input", () => {
        onInput(input.value.trim());
        open(true);
    });
    input.addEventListener("click", () => open(false));
    input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (list.hidden) open(false);
            setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Enter" && !list.hidden && activeIndex >= 0) {
            event.preventDefault();
            choose(visibleValues[activeIndex]);
        } else if (event.key === "Escape" && !list.hidden) {
            event.preventDefault();
            close();
        }
    });
    input.addEventListener("blur", () => setTimeout(close, 0));
    input.addEventListener("change", () => {
        onInput(input.value.trim());
        onCommit?.(input.value.trim());
    });
    return {
        wrapper,
        input,
        hintNode,
        setOptions(nextValues) {
            values = [...nextValues];
            if (!list.hidden) open(filtering);
        },
    };
}

export function renderConnectionPanel(container, state, handlers) {
    const { onDraftChange, onOrganizationCommitted, onSave, onClearDefault, onCancel } = handlers;
    container.replaceChildren();

    const panel = element("section", "connection-panel");
    const title = element("h2", "connection-title");
    const intro = element("p", "connection-intro");
    const current = element("div", "connection-current");
    panel.append(title, intro, current);

    const form = element("form", "connection-form");
    const organization = field("connectionOrganizations", "Organization", "Required.", {
        onInput: (value) => onDraftChange({ organization: value }),
        onCommit: (value) => onOrganizationCommitted(value),
    });
    const project = field(
        "connectionProjects",
        "Project",
        "Optional. Azure DevOps has no organization-wide pull request list, so without a project this connection shows work items only.",
        { onInput: (value) => onDraftChange({ project: value }) },
    );
    const repository = field(
        "connectionRepositories",
        "Repository",
        "Optional. Narrows pull requests to one repository instead of the whole project.",
        { onInput: (value) => onDraftChange({ repositoryId: value }) },
    );
    organization.input.placeholder = "contoso";
    form.append(organization.wrapper, project.wrapper, repository.wrapper);

    const pin = element("label", "connection-toggle");
    const pinInput = element("input");
    pinInput.type = "checkbox";
    pinInput.addEventListener("change", () => onDraftChange({ isDefault: pinInput.checked }));
    pin.append(
        pinInput,
        element("span", "", "Set as default"),
        element(
            "span",
            "connection-field-hint",
            "A default is always included, even when a different organization is active or the repository has its own Azure DevOps remote.",
        ),
    );
    form.append(pin);

    const error = element("div", "connection-error");
    const actions = element("div", "connection-actions");
    const save = element("button", "", "Use this organization");
    save.type = "submit";
    const clear = element("button", "secondary", "Clear default");
    clear.type = "button";
    clear.addEventListener("click", onClearDefault);
    const cancel = element("button", "secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", onCancel);
    actions.append(save, clear, cancel);
    form.append(error, actions);

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        onSave();
    });
    panel.append(form);
    container.append(panel);

    const update = (next) => {
        const {
            connections = [],
            organizations = [],
            organizationsError = "",
            projects = [],
            repositories = [],
            draft = {},
            loading = "",
            error: errorText = "",
            saving = false,
            hasDefault = false,
            firstRun = false,
        } = next;

        title.textContent = firstRun ? "Connect to Azure DevOps" : "Azure DevOps connection";
        intro.textContent = firstRun
            ? "No Azure DevOps remote was detected in this session. Choose an organization to see your pull requests and work items anyway."
            : "Choose the organization this canvas reads from. A detected Azure DevOps remote is always shown first, then whatever you choose here, with your default below that.";

        current.replaceChildren();
        current.hidden = !connections.length;
        if (connections.length) {
            current.append(element("span", "connection-current-label", "Showing"));
            for (const connection of connections) {
                const row = element("div", "connection-current-row");
                row.append(
                    element("span", "connection-current-name", connectionLabel(connection)),
                    element("span", "connection-current-source", sourceLabel(connection)),
                );
                if (connection.isDefault) {
                    row.append(element("span", "connection-pill", "default"));
                }
                current.append(row);
            }
        }

        // Field values are only written when they differ, so patching never moves
        // the caret in a field the user is still typing in.
        for (const [node, value] of [
            [organization.input, draft.organization || ""],
            [project.input, draft.project || ""],
            [repository.input, draft.repositoryId || ""],
        ]) {
            if (node.value !== value) {
                node.value = value;
            }
        }
        pinInput.checked = Boolean(draft.isDefault);

        organization.setOptions(organizations);
        project.setOptions(projects);
        repository.setOptions(repositories);
        organization.hintNode.textContent = organizationsError
            ? `Could not list your organizations (${organizationsError}). Type the name instead.`
            : "Required.";

        project.input.disabled = !draft.organization;
        repository.input.disabled = !draft.organization;
        project.input.placeholder = loading === "options" ? "Loading projects..." : "Optional";
        repository.input.placeholder = loading === "options" ? "Loading repositories..." : "Optional";

        error.textContent = errorText;
        error.hidden = !errorText;
        save.textContent = saving ? "Saving..." : "Use this organization";
        save.disabled = saving || !draft.organization;
        clear.hidden = !hasDefault;
        clear.disabled = saving;
        cancel.hidden = firstRun;
        cancel.disabled = saving;
    };

    update(state);
    // The fields are the record of what the user chose, not the draft: an engine
    // that does not raise the event a field listens for would otherwise drop a
    // value the user can plainly see in front of them.
    const read = () => ({
        organization: organization.input.value.trim(),
        project: project.input.value.trim(),
        repositoryId: repository.input.value.trim(),
        isDefault: pinInput.checked,
    });
    return { update, read };
}
