const el = (id) => document.getElementById(id);

const errorBox = el('error');
const connectView = el('connect-view');
const importView = el('import-view');
const connectForm = el('connect-form');
const backendUrlInput = el('backend-url');
const patTokenInput = el('pat-token');
const connectSubmit = el('connect-submit');
const connectedUrlLabel = el('connected-url');
const disconnectLink = el('disconnect-link');
const importReady = el('import-ready');
const importButton = el('import-button');
const previewForm = el('preview-form');
const previewCancel = el('preview-cancel');
const previewSave = el('preview-save');
const successMsg = el('success');

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response === undefined) {
        reject(new Error('No response from the extension background script.'));
        return;
      }
      resolve(response);
    });
  });
}

// Only https:// (or plain http:// on localhost, for local dev) is allowed
// as a backend URL - the raw PAT gets sent to this origin on every connect
// and every token refresh, so a plaintext non-localhost origin would ship
// the credential in the clear.
function isAllowedBackendUrl(url) {
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || isLocalhost;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.classList.add('hidden');
}

function resetImportView() {
  importReady.classList.remove('hidden');
  previewForm.classList.add('hidden');
  successMsg.classList.add('hidden');
}

async function showConnectedState(backendUrl) {
  connectView.classList.add('hidden');
  importView.classList.remove('hidden');
  connectedUrlLabel.textContent = backendUrl;
  resetImportView();
}

function showDisconnectedState() {
  importView.classList.add('hidden');
  connectView.classList.remove('hidden');
  backendUrlInput.value = DEFAULT_BACKEND_URL;
}

async function init() {
  try {
    const status = await sendMessage({ type: 'status' });
    if (status.connected) {
      await showConnectedState(status.backendUrl);
    } else {
      backendUrlInput.value = status.backendUrl || DEFAULT_BACKEND_URL;
      showDisconnectedState();
    }
  } catch (err) {
    showDisconnectedState();
    showError(err.message || 'Could not reach the extension background script. Reopen this popup to retry.');
  }
}

connectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  connectSubmit.disabled = true;
  connectSubmit.textContent = 'Connecting…';

  try {
    const backendUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
    const url = new URL(backendUrl);
    if (!isAllowedBackendUrl(url)) {
      showError('Backend URL must use https:// (plain http:// is only allowed for localhost).');
      return;
    }

    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) {
      showError('Permission to reach that URL was not granted.');
      return;
    }

    const result = await sendMessage({
      type: 'connect',
      backendUrl,
      patToken: patTokenInput.value.trim(),
    });

    if (!result.ok) {
      showError(result.error || 'Could not connect.');
      return;
    }

    patTokenInput.value = '';
    await showConnectedState(backendUrl);
  } catch (err) {
    showError(err.message || 'Could not connect.');
  } finally {
    connectSubmit.disabled = false;
    connectSubmit.textContent = 'Connect';
  }
});

disconnectLink.addEventListener('click', async (e) => {
  e.preventDefault();
  await sendMessage({ type: 'disconnect' });
  showDisconnectedState();
});

// Some job boards (Indeed in particular) put the posting behind a bot
// challenge that rejects the backend's server-side fetch outright, so the
// backend never sees real page content. Pulling the text straight out of
// the user's own tab sidesteps that - it's the page already rendered in
// their browser, no re-fetch involved. Truncated/whitespace-collapsed to
// match ParseJobDto's `text` field (MaxLength 20000) and the shape the
// backend's own cheerio-based extraction already produces.
async function extractPageText(tabId) {
  if (!tabId) return '';
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const main =
          document.querySelector('#jobDescriptionText') || // Indeed
          document.querySelector('.jobs-description') || // LinkedIn
          document.body;
        return main ? main.innerText : '';
      },
    });
    return (injection?.result || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
  } catch {
    return '';
  }
}

importButton.addEventListener('click', async () => {
  clearError();
  importButton.disabled = true;
  importButton.textContent = 'Reading page…';

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) throw new Error('No active tab URL found.');

    const text = await extractPageText(tab.id);
    const result = await sendMessage({ type: 'parseJob', url: tab.url, text });
    if (!result.ok) throw new Error(result.error || 'Could not parse this page.');

    const data = result.data || {};
    el('field-company').value = data.company || '';
    el('field-position').value = data.position || '';
    el('field-location').value = data.location || '';
    el('field-job-type').value = data.jobType || 'ONSITE';
    el('field-application-channel').value =
      data.applicationChannel || 'COMPANY_WEBSITE';
    previewForm.dataset.url = data.url || tab.url;

    importReady.classList.add('hidden');
    previewForm.classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  } finally {
    importButton.disabled = false;
    importButton.textContent = 'Import this job';
  }
});

previewCancel.addEventListener('click', () => {
  clearError();
  resetImportView();
});

previewForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  previewSave.disabled = true;
  previewSave.textContent = 'Adding…';

  try {
    const payload = {
      company: el('field-company').value.trim(),
      position: el('field-position').value.trim(),
      location: el('field-location').value.trim() || undefined,
      url: previewForm.dataset.url || undefined,
      jobType: el('field-job-type').value,
      applicationChannel: el('field-application-channel').value,
    };

    const result = await sendMessage({ type: 'createJob', payload });
    if (!result.ok) throw new Error(result.error || 'Could not add job.');

    previewForm.classList.add('hidden');
    successMsg.classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  } finally {
    previewSave.disabled = false;
    previewSave.textContent = 'Add to Job Tracker';
  }
});

init();
