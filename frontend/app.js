// Shared helpers for both pages.
const API_URL = 'https://pixel-link-2xiq.onrender.com';

// Transient, screen-reader-announced error banner (the element carries
// role="status" aria-live="polite" so assistive tech reads the update).
function createErrorReporter(element, timeout = 3000) {
    let timer = null;

    return function showError(message) {
        clearTimeout(timer);
        element.textContent = message;
        element.classList.add('visible');
        timer = setTimeout(() => {
            element.classList.remove('visible');
            element.textContent = '';
        }, timeout);
    };
}

// Run an async action while the button shows a busy state
async function withBusyButton(button, busyLabel, action) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;

    try {
        return await action();
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

// fetch + JSON + error unwrapping in one place
async function requestJson(path, options) {
    const response = await fetch(`${API_URL}${path}`, options);

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        // Non-JSON body (proxy error page, cold-start timeout)
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        throw new Error('Unexpected response from server');
    }

    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// Submit on Enter. `keydown` - `keypress` is deprecated and absent from
// some mobile keyboards.
function submitOnEnter(input, button) {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            button.click();
        }
    });
}

// Clipboard write that reports failure instead of silently doing nothing.
// navigator.clipboard is undefined on insecure origins, and can reject when
// permission is denied or the document is not focused.
async function copyText(text) {
    if (!navigator.clipboard) {
        throw new Error('Clipboard needs a secure (https) connection');
    }
    await navigator.clipboard.writeText(text);
}
