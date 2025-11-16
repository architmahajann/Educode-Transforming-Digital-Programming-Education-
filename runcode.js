// Run code functionality for admin panel and student room

// Unicode-safe base64 helpers
const b64encode = (str) => {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
};
const b64decode = (str) => {
    try { return decodeURIComponent(escape(atob(str))); } catch { return atob(str); }
};

// Resolve Judge0 API key from meta tag or window variable
function getJudge0Key() {
    if (window.JUDGE0_API_KEY) return window.JUDGE0_API_KEY;
    const meta = document.querySelector('meta[name="judge0-api-key"]');
    return meta && meta.content ? meta.content : '';
}

document.getElementById('runcode')?.addEventListener('click', async function () {
    try {
        if (typeof editor === 'undefined' || !editor) {
            tata.error('Editor', 'Editor is not initialized', { animate: 'fade', position: 'tm' });
            return;
        }
        const code = editor.getValue();
        const input = document.getElementById('codeinput')?.value || '';
        let languageId = parseInt(languageid, 10);
        if (Number.isNaN(languageId)) {
            const sel = document.getElementById('language');
            if (sel && sel.value) languageId = parseInt(sel.value, 10);
        }

        if (!code || code.trim() === '') {
            tata.warn('Warning', 'Please write some code first', {
                animate: 'fade',
                position: 'tm'
            });
            return;
        }
        if (!languageId || Number.isNaN(languageId)) {
            tata.error('Language', 'Unable to detect language', { animate: 'fade', position: 'tm' });
            return;
        }
        if (typeof axios === 'undefined') {
            tata.error('Network', 'Axios not available on page', { animate: 'fade', position: 'tm' });
            return;
        }

        // Show loading state
        const outputDiv = document.getElementById('output');
        if (outputDiv) {
            outputDiv.innerHTML = '<p style="color: #999;">Running code...</p>';
        }

        // Prepare the request payload for Judge0 API
        const payload = {
            source_code: b64encode(code), // Base64 encode
            language_id: parseInt(languageId, 10),
            stdin: b64encode(input), // Base64 encode input
        };

        // Submit code to Judge0 API
        const response = await axios.post(
            'https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=true&wait=true',
            payload,
            {
                headers: {
                    'content-type': 'application/json',
                    'X-RapidAPI-Key': getJudge0Key(),
                    'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
                }
            }
        );

        const result = response.data;

        // Display output
        if (outputDiv) {
            if (result.stdout) {
                outputDiv.innerHTML = `<pre style="color: #00ff00; white-space:pre-wrap;">${b64decode(result.stdout)}</pre>`;
            } else if (result.stderr) {
                outputDiv.innerHTML = `<pre style="color: #ff6b6b; white-space:pre-wrap;">${b64decode(result.stderr)}</pre>`;
            } else if (result.compile_output) {
                outputDiv.innerHTML = `<pre style="color: #ffa500; white-space:pre-wrap;">${b64decode(result.compile_output)}</pre>`;
            } else if (result.message) {
                outputDiv.innerHTML = `<pre style="color: #ff6b6b;">${result.message}</pre>`;
            } else {
                outputDiv.innerHTML = '<p style="color: #999;">No output</p>';
            }
        }

        tata.success('Success', 'Code executed successfully', {
            animate: 'fade',
            position: 'tm'
        });

    } catch (error) {
        console.error('Error running code:', error);
        const outputDiv = document.getElementById('output');
        if (outputDiv) {
            outputDiv.innerHTML = `<pre style="color: #ff6b6b;">Error: ${error.message || 'Failed to run code'}</pre>`;
        }
        tata.error('Error', 'Failed to execute code. Please check your API key.', {
            animate: 'fade',
            position: 'tm'
        });
    }
});
