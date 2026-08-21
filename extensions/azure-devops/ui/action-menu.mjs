// The Primer action menu the pull request view uses for the comment filter and
// for the review and state actions. It lived inline in the comment filter first;
// it is here so the action menus behave identically rather than approximately,
// including the roving focus and the outside-pointer close.

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = String(text);
    }
    return node;
}

function svgPath(className, viewBox, size, pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add(className);
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
}

const CARET_PATH = "M3.22 4.47a.75.75 0 0 1 1.06 0L6 6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06L6.53 7.78a.75.75 0 0 1-1.06 0L3.22 5.53a.75.75 0 0 1 0-1.06Z";
const CHECK_PATH = "M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z";

/**
 * Builds a Primer action menu.
 *
 * Items are `{ id, label, checked, role, dataset, disabled, danger, onSelect }`.
 * `checked` renders the check column and reports `aria-checked`, so a menu whose
 * items are mutually exclusive choices should use `role: "menuitemradio"`, and a
 * menu of commands should leave the role at its `menuitem` default.
 */
export function createActionMenu({
    id,
    className = "",
    triggerLabel,
    triggerAriaLabel,
    menuAriaLabel,
    items = [],
    onSelect,
}) {
    const control = element("div", ["primer-action-menu", className].filter(Boolean).join(" "));
    control.dataset.component = "ActionMenu";

    const trigger = element("button", "primer-button primer-action-menu-trigger");
    trigger.type = "button";
    trigger.dataset.component = "ActionMenu.Button";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", id);
    trigger.setAttribute("aria-label", triggerAriaLabel || triggerLabel);
    trigger.append(element("span", "primer-action-menu-trigger-label", triggerLabel));
    trigger.append(svgPath("primer-action-menu-caret", "0 0 12 12", 12, CARET_PATH));

    const overlay = element("div", "primer-action-menu-overlay");
    overlay.dataset.component = "ActionMenu.Overlay";
    overlay.hidden = true;

    const menu = element("ul", "primer-action-list");
    menu.id = id;
    menu.dataset.component = "ActionList";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", menuAriaLabel || triggerLabel);

    const menuItems = [];
    for (const item of items) {
        const listItem = element("li", "primer-action-list-item");
        listItem.setAttribute("role", "none");
        const action = element("button", ["primer-action-list-button", item.danger ? "danger" : ""].filter(Boolean).join(" "));
        action.type = "button";
        action.dataset.component = "ActionList.Item";
        for (const [key, value] of Object.entries(item.dataset || {})) {
            action.dataset[key] = value;
        }
        action.setAttribute("role", item.role || (item.checked === undefined ? "menuitem" : "menuitemradio"));
        if (item.checked !== undefined) {
            action.setAttribute("aria-checked", String(Boolean(item.checked)));
        }
        if (item.disabled) {
            action.disabled = true;
            action.setAttribute("aria-disabled", "true");
        }
        if (item.checked !== undefined) {
            action.append(svgPath("primer-action-list-check", "0 0 16 16", 16, CHECK_PATH));
        }
        action.append(element("span", "primer-action-list-label", item.label));
        if (item.description) {
            action.append(element("span", "primer-action-list-description", item.description));
        }
        action.addEventListener("click", () => {
            setOpen(false);
            (item.onSelect || onSelect)?.(item.id, item);
        });
        listItem.append(action);
        menu.append(listItem);
        menuItems.push(action);
    }
    overlay.append(menu);

    const closeOnOutsidePointer = (event) => {
        if (!control.contains(event.target)) setOpen(false);
    };

    // The overlay is positioned against the viewport rather than the trigger, so
    // that a card with `overflow: hidden` (which the reviewer and work item cards
    // need for their rounded corners) cannot clip the menu. The cost is that the
    // position has to be recomputed whenever anything moves.
    const positionOverlay = () => {
        const rect = trigger.getBoundingClientRect();
        const { offsetWidth: width, offsetHeight: height } = overlay;
        const viewportWidth = document.documentElement.clientWidth || 0;
        const viewportHeight = document.documentElement.clientHeight || 0;
        const margin = 8;
        // Right-aligned to the trigger, pulled back on screen if that overflows.
        let left = rect.right - width;
        if (left + width > viewportWidth - margin) left = viewportWidth - margin - width;
        if (left < margin) left = margin;
        // Below the trigger, flipped above it only when there is room there and
        // not below, so a menu near the bottom edge stays reachable.
        let top = rect.bottom + 4;
        if (top + height > viewportHeight - margin && rect.top - height - 4 >= margin) {
            top = rect.top - height - 4;
        }
        overlay.style.left = `${Math.round(left)}px`;
        overlay.style.top = `${Math.round(top)}px`;
    };
    // Capture so a scroll in any ancestor is seen, not just one on the document.
    const reposition = () => positionOverlay();
    const setOpen = (open, focusMenu = false) => {
        overlay.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        document.removeEventListener("pointerdown", closeOnOutsidePointer);
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", reposition);
        if (open) {
            positionOverlay();
            document.addEventListener("pointerdown", closeOnOutsidePointer);
            window.addEventListener("scroll", reposition, true);
            window.addEventListener("resize", reposition);
        }
        if (open && focusMenu) {
            (menuItems.find((entry) => entry.getAttribute("aria-checked") === "true") || menuItems[0])?.focus();
        }
    };

    trigger.addEventListener("click", () => setOpen(overlay.hidden));
    trigger.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true, true);
        }
    });
    menu.addEventListener("keydown", (event) => {
        const index = menuItems.indexOf(document.activeElement);
        let nextIndex;
        if (event.key === "ArrowDown") nextIndex = (index + 1) % menuItems.length;
        else if (event.key === "ArrowUp") nextIndex = (index - 1 + menuItems.length) % menuItems.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = menuItems.length - 1;
        else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            trigger.focus();
            return;
        }
        if (nextIndex !== undefined) {
            event.preventDefault();
            menuItems[nextIndex].focus();
        }
    });
    control.addEventListener("focusout", () => {
        setTimeout(() => {
            if (!control.contains(document.activeElement)) setOpen(false);
        });
    });

    control.append(trigger, overlay);
    return { control, trigger, menu, setOpen };
}
