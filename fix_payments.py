import re

with open('www/layout.js', 'r') as f:
    content = f.read()

# Add Browser plugin reference near the top, right after BACKEND_URL is defined
content = content.replace(
    'const BACKEND_URL',
    'const { Browser } = Capacitor.Plugins;\nconst BACKEND_URL',
    1
)

def build_replacement(provider):
    old_pattern = re.compile(
        r"const popup = window\.open\(data\.authorization_url.*?"
        rf"showToast\(error\.message \|\| '{provider} initialization failed\. Falling back to local confirmation\.'\);\s*"
        r"completeCheckout\(\);\s*\}\s*\}",
        re.DOTALL
    )
    new_code = f"""await Browser.open({{ url: data.authorization_url }});

        const listenerHandle = await Browser.addListener('browserFinished', async () => {{
            listenerHandle.remove();
            if (!currentAppState.paymentReference) return;

            try {{
                const verifyRes = await fetch(`${{BACKEND_URL}}/{provider.lower()}/verify`, {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ reference: currentAppState.paymentReference }})
                }});
                const verifyData = await readJsonResponse(verifyRes);
                if (verifyRes.ok && verifyData.status === 'success') {{
                    completeCheckout();
                }} else {{
                    currentAppState.paymentReference = null;
                    showToast(verifyData.error || 'Payment was not completed. Please try again.');
                }}
            }} catch (error) {{
                currentAppState.paymentReference = null;
                showToast(error.message || 'Payment confirmation failed.');
            }}
        }});
    }} catch (error) {{
        currentAppState.paymentReference = null;
        showToast(error.message || '{provider} checkout could not be started. Please try again.');
    }}
}}"""
    return old_pattern, new_code

count = 0
for provider in ['Paystack', 'Flutterwave']:
    pattern, replacement = build_replacement(provider)
    new_content, n = pattern.subn(replacement, content)
    if n == 1:
        content = new_content
        count += 1
        print(f"{provider}: replaced successfully")
    else:
        print(f"{provider}: FAILED to match (found {n} matches, expected 1)")

with open('www/layout.js', 'w') as f:
    f.write(content)

print(f"\nTotal replacements: {count}/2")
