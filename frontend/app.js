// Shared helpers for every page.

// The API is proxied through Vercel (see vercel.json), so in production it is
// same-origin and the session cookie is first-party. Opening the HTML straight
// from disk has no proxy, so fall back to calling the backend directly.
const BACKEND_ORIGIN = 'https://pixel-link-2xiq.onrender.com';
const API_URL = location.protocol === 'file:' ? BACKEND_ORIGIN : '';

// Render's free tier sleeps when idle, and a cold start can outlast Vercel's
// proxy timeout - so the first real request would fail rather than just be
// slow. Poke the backend directly on load and ignore the result.
function warmBackend() {
    fetch(BACKEND_ORIGIN + '/health', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

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
async function requestJson(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        // Send the session cookie. Needed on the file:// fallback, harmless
        // (and correct) on the same-origin proxied path.
        credentials: 'include',
        ...options
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        // Non-JSON body (proxy error page, cold-start timeout)
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        throw new Error('Unexpected response from server');
    }

    if (!response.ok) {
        const error = new Error(data.error || 'Request failed');
        error.status = response.status;
        throw error;
    }

    return data;
}

// Who is signed in, or null. Never throws - every page works signed out.
async function currentUser() {
    try {
        const data = await requestJson('/api/auth/me');
        return data.user;
    } catch (_) {
        return null;
    }
}

async function logout() {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
    } catch (_) {
        // Falling through still sends the user to a signed-out page
    }
}

// Renders the shared "Sign in" / "email · Log out" control that sits in the
// page corner. Returns the user so callers can branch on it.
async function renderSessionNav(container) {
    const user = await currentUser();

    if (!container) return user;

    container.textContent = '';

    // The nav owns the top-left corner, so a page that also wants a "back"
    // link declares it here (data-back) rather than positioning its own
    // element in the same spot.
    if (container.dataset.back) {
        const back = document.createElement('a');
        back.href = container.dataset.back;
        back.className = 'session-link';
        back.textContent = '← Back';
        container.appendChild(back);
    }

    if (!user) {
        // The sign-in page sets data-hide-signin: offering "Sign in" there
        // would just point at the page you are already on.
        if (container.dataset.hideSignin === undefined) {
            const link = document.createElement('a');
            link.href = 'login.html';
            link.className = 'session-link';
            link.textContent = 'Sign in';
            container.appendChild(link);
        }
        return null;
    }

    // The list pages render the nav in normal flow, where a full email fits.
    // The centred pages position it absolutely opposite a centred title, so a
    // long email would grow the nav until it collided with the heading - show
    // a short label there instead.
    const roomy = document.body.classList.contains('page-list');

    const who = document.createElement('a');
    who.href = 'account.html';
    who.className = 'session-link';
    who.textContent = roomy ? user.email : 'Account';
    who.title = user.email;
    container.appendChild(who);

    if (user.role === 'admin') {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'session-link';
        adminLink.textContent = 'Admin';
        container.appendChild(adminLink);
    }

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'session-link session-logout';
    out.textContent = 'Log out';
    out.addEventListener('click', async () => {
        out.disabled = true;
        await logout();
        location.reload();
    });
    container.appendChild(out);

    return user;
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
