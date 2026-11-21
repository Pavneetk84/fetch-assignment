// =============================================================
// Fetch Assignment - main.js
// Login with dummyjson, keep the token in sessionStorage,
// fetch the authorized posts and show them 10 at a time.
// =============================================================

const BASE_URL = 'https://dummyjson.com';
const STORAGE_KEY = 'fetch-assignment-auth'; // sessionStorage key for { token, user }
const PAGE_SIZE = 10;

// small inline SVG icons (Material Symbols), they use the text colour
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const icons = {
  like: svg('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'),
  dislike: svg('M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z'),
  views: svg('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'),
};

// app state
let currentPage = 0;
let totalPosts = 0;
let activeTag = null;

// -------------------------------------------------------------
// Custom Error (challenge): keeps the details of the Response
// -------------------------------------------------------------
class FetchError extends Error {
  constructor(response, message) {
    super(message || `${response.status} ${response.statusText}`);
    this.name = 'FetchError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
  }
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  addListeners();

  // logged in = there is an object with a token in sessionStorage
  const auth = getAuth();
  if (auth?.token) {
    showUser(auth.user);
    getPosts();
  } else {
    setState('public');
  }
}

function addListeners() {
  document.getElementById('login_form').addEventListener('submit', login);
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('btnPrev').addEventListener('click', () => changePage(-1));
  document.getElementById('btnNext').addEventListener('click', () => changePage(1));
  // one listener for all the like/dislike/tag buttons inside the posts
  document.querySelector('section.loaded').addEventListener('click', handlePostClick);
}

// set ONE state class on the body: public | authenticating | fetching | loaded
function setState(state) {
  document.body.className = state;
}

// ---------------- sessionStorage helpers ----------------

function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveAuth(token, user) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
}

// ---------------- Login ----------------

async function login(ev) {
  ev.preventDefault();
  const form = ev.target;
  const username = form.username.value.trim();
  const password = form.pass.value;

  setState('authenticating');

  try {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, expiresInMins: 60 }),
    });
    if (!response.ok) {
      // dummyjson sends { message: "Invalid credentials" } on a 400
      const data = await response.json().catch(() => ({}));
      throw new FetchError(response, data.message);
    }
    const data = await response.json();

    // newer dummyjson versions call it accessToken, older ones call it token
    const token = data.accessToken ?? data.token;
    const { id, username: name, firstName, lastName, email, image } = data;
    const user = { id, username: name, firstName, lastName, email, image };

    saveAuth(token, user);
    form.reset();
    showUser(user);
    showMessage('success', 'Welcome back!', `Logged in as ${firstName} ${lastName}.`);
    getPosts();
  } catch (err) {
    setState('public');
    showError('Login failed', err);
  }
}

// ---------------- Logout ----------------

function logout(ev) {
  ev.preventDefault();
  sessionStorage.removeItem(STORAGE_KEY);
  document.querySelector('section.loaded').innerHTML = ''; // remove all the posts
  document.querySelector('h1 .user').innerHTML = ''; // remove the user details
  document.getElementById('pageInfo').textContent = '';
  currentPage = 0;
  totalPosts = 0;
  activeTag = null;
  setState('public'); // hides logout, shows the login form
  history.replaceState(null, '', location.pathname); // drop the #logout from the url
  showMessage('info', 'Logged out', 'Your session has been cleared. See you next time.');
}

// ---------------- Show the user in the header ----------------

function showUser(user) {
  const span = document.querySelector('h1 .user');
  span.innerHTML = `
    <img src="${user.image}" alt="" width="44" height="44" />
    <span>
      <strong>${user.firstName} ${user.lastName}</strong>
      <small>@${user.username} &middot; ${user.email}</small>
    </span>`;
}

// ---------------- Posts ----------------

async function getPosts(page = currentPage) {
  const auth = getAuth();
  if (!auth?.token) return setState('public');

  setState('fetching');
  const skip = page * PAGE_SIZE;
  const url = `${BASE_URL}/auth/posts?limit=${PAGE_SIZE}&skip=${skip}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new FetchError(response, data.message);
    }
    const data = await response.json();
    currentPage = page; // only change page once the request worked
    totalPosts = data.total;
    activeTag = null;
    buildPosts(data.posts);
    updatePager();
    setState('loaded');
  } catch (err) {
    if (err instanceof FetchError && err.status === 401) {
      // token expired or invalid: log the user out
      showError('Your session has expired', err);
      sessionStorage.removeItem(STORAGE_KEY);
      document.querySelector('h1 .user').innerHTML = '';
      setState('public');
      return;
    }
    // keep the user logged in so they can try again (the pager stays on the old page)
    setState('loaded');
    showError('Could not load the posts', err);
  }
}

function buildPosts(posts) {
  const section = document.querySelector('section.loaded');
  section.innerHTML = posts
    .map((post) => {
      const tags = post.tags
        .map((tag) => `<li><button type="button" class="tag" aria-pressed="false">${tag}</button></li>`)
        .join('');
      return `
      <article class="post" data-id="${post.id}" data-tags="${post.tags.join(' ')}">
        <span class="id">Post #${post.id}</span>
        <h3>${post.title}</h3>
        <p>${post.body}</p>
        <ul class="tags">${tags}</ul>
        <div class="stats">
          <button type="button" class="like" aria-pressed="false" data-count="${post.reactions.likes}">
            ${icons.like} <span>${post.reactions.likes}</span>
          </button>
          <button type="button" class="dislike" aria-pressed="false" data-count="${post.reactions.dislikes}">
            ${icons.dislike} <span>${post.reactions.dislikes}</span>
          </button>
          <span class="views">${icons.views} ${post.views.toLocaleString()} views</span>
        </div>
      </article>`;
    })
    .join('');
}

// like / dislike toggles and tag filtering
function handlePostClick(ev) {
  const btn = ev.target.closest('button');
  if (!btn) return;

  if (btn.matches('.like, .dislike')) {
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    // only one of like / dislike can be on for a post
    const other = btn.parentElement.querySelector(btn.matches('.like') ? '.dislike' : '.like');
    if (!pressed && other.getAttribute('aria-pressed') === 'true') toggleReaction(other, false);
    toggleReaction(btn, !pressed);
  } else if (btn.matches('.tag')) {
    filterByTag(btn.textContent === activeTag ? null : btn.textContent);
  } else if (btn.matches('.clear-filter')) {
    filterByTag(null);
  }
}

function toggleReaction(btn, on) {
  const base = Number(btn.dataset.count);
  btn.setAttribute('aria-pressed', on);
  btn.querySelector('span').textContent = on ? base + 1 : base;
}

// show only the posts on this page that have the tag (null shows all)
function filterByTag(tag) {
  activeTag = tag;
  const section = document.querySelector('section.loaded');
  section.querySelector('.filter-note')?.remove();

  section.querySelectorAll('.post').forEach((post) => {
    post.hidden = tag ? !post.dataset.tags.split(' ').includes(tag) : false;
  });
  section.querySelectorAll('.tag').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.textContent === tag);
  });

  if (tag) {
    const count = section.querySelectorAll('.post:not([hidden])').length;
    section.insertAdjacentHTML(
      'afterbegin',
      `<p class="filter-note">Showing ${count} post${count === 1 ? '' : 's'} tagged <strong>#${tag}</strong>
       <button type="button" class="clear-filter">Show all</button></p>`
    );
  }
}

// ---------------- Pagination (challenge) ----------------

function updatePager() {
  const lastPage = Math.max(0, Math.ceil(totalPosts / PAGE_SIZE) - 1);
  document.getElementById('btnPrev').disabled = currentPage === 0;
  document.getElementById('btnNext').disabled = currentPage >= lastPage;
  document.getElementById('pageInfo').textContent = `Page ${currentPage + 1} of ${lastPage + 1}`;
}

function changePage(step) {
  getPosts(currentPage + step);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------- Dialogs (challenge: self-removing) ----------------

function showError(title, err) {
  let details = err.message;
  if (err instanceof FetchError) {
    details = `${err.message} (status ${err.status})`;
  } else if (err instanceof TypeError) {
    details = 'Could not reach the server. Check your internet connection and try again.';
  }
  showMessage('error', title, details, err.url);
}

// type is info | success | error. The dialog removes itself when closed.
function showMessage(type, title, text, url = '') {
  const dialog = document.createElement('dialog');
  dialog.className = `message ${type}`;
  dialog.innerHTML = `
    <h2>${title}</h2>
    <p>${text}</p>
    ${url ? `<small>${url}</small>` : ''}
    <form method="dialog"><button>OK</button></form>`;
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  // success and info messages close on their own after a few seconds
  if (type !== 'error') {
    setTimeout(() => dialog.open && dialog.close(), 2500);
  }
}
