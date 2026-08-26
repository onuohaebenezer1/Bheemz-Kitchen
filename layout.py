import json
import os
import re
import secrets
import time
import logging
import urllib.request
import urllib.error
from urllib.parse import urlparse

import smtplib
from email.mime.text import MIMEText

from functools import wraps
from contextlib import contextmanager

from flask import Flask, jsonify, request, session, redirect, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

try:
    import bcrypt
except ImportError:  # pragma: no cover
    bcrypt = None

try:
    import psycopg2
    from psycopg2 import pool as pg_pool
    from psycopg2.extras import RealDictCursor
except ImportError:  # pragma: no cover
    psycopg2 = None
    pg_pool = None
    RealDictCursor = None

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WWW_DIR = os.path.join(BASE_DIR, 'www')

app = Flask(__name__, static_folder=WWW_DIR, static_url_path='')

# FLASK_SECRET_KEY is required for signed session cookies (login state).
# Generate one with: python -c "import secrets; print(secrets.token_hex(32))"
app.secret_key = os.getenv('FLASK_SECRET_KEY')
if not app.secret_key:
    raise RuntimeError('FLASK_SECRET_KEY must be set in the environment/.env file.')

# Lock CORS down to known frontend origin(s) instead of allowing every origin.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv('ALLOWED_ORIGINS', '').split(',') if o.strip()]
CORS(app, origins=ALLOWED_ORIGINS or '*', supports_credentials=True)

DEBUG_MODE = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'

PAYSTACK_SECRET_KEY = os.getenv('PAYSTACK_SECRET_KEY', '').strip()
PAYSTACK_BASE_URL = 'https://api.paystack.co'
PAYSTACK_CALLBACK_URL = os.getenv('PAYSTACK_CALLBACK_URL', 'https://bheemz-kitchen-2.onrender.com')
FRONTEND_SUCCESS_URL = os.getenv('FRONTEND_SUCCESS_URL', 'https://bheemz-kitchen-2.onrender.com')

SMTP_EMAIL = (os.getenv('SMTP_EMAIL') or os.getenv('GMAIL_EMAIL') or '').strip().lower()
SMTP_APP_PASSWORD = (os.getenv('SMTP_APP_PASSWORD') or os.getenv('GMAIL_APP_PASSWORD') or '').strip().replace(' ', '')
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com').strip()
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_FROM = os.getenv('SMTP_FROM', SMTP_EMAIL).strip().lower()
DATABASE_URL = (os.getenv('DATABASE_URL') or os.getenv('INTERNAL_DATABASE_URL') or '').strip()
DATABASE_ENABLED = psycopg2 is not None and bool(DATABASE_URL or os.getenv('DB_HOST', '').strip())


def send_email(to_email, subject, body):
    if not SMTP_EMAIL or not SMTP_APP_PASSWORD:
        logger.warning('SMTP_EMAIL and SMTP_APP_PASSWORD are required; email not sent to %s', to_email)
        return False
    try:
        msg = MIMEText(body)
        msg['Subject'] = subject
        msg['From'] = SMTP_FROM
        msg['To'] = to_email

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_FROM, [to_email], msg.as_string())
        return True
    except Exception:
        logger.exception('Failed to send email to %s', to_email)
        return False

FLUTTERWAVE_SECRET_KEY = os.getenv('FLUTTERWAVE_SECRET_KEY', '').strip()
FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com'
FLUTTERWAVE_CALLBACK_URL = os.getenv('FLUTTERWAVE_CALLBACK_URL', 'https://bheemz-kitchen-2.onrender.com')
FRONTEND_SUCCESS_URL = os.getenv('FRONTEND_SUCCESS_URL', 'https://bheemz-kitchen-2.onrender.com')

REFERENCE_RE = re.compile(r'^[A-Za-z0-9_\-]{1,64}$')

# References this server itself generated in demo mode, so /verify can't be
# spoofed by just sending any string that starts with "demo-".
_DEMO_REFERENCES = set()
_REFERENCE_METADATA = {}
_MEMORY_USERS = []
_MEMORY_PROFILES = {}
_MEMORY_CARTS = {}
_MEMORY_ORDERS = []
_MEMORY_BANK_ACCOUNTS = {}
_MEMORY_BANK_TRANSACTIONS = []
_MEMORY_PASSWORD_RESET_REQUESTS = []
_MEMORY_PASSWORD_RESET_TOKENS = {}
_MEMORY_EMAIL_VERIFICATIONS = {}
_MEMORY_EMAIL_VERIFICATION_TOKENS = {}
_MEMORY_EXPERTS = [
    {'id': 1, 'name': 'Dr. Amaka Obi', 'title': 'Registered Dietitian', 'specialty': 'Diabetes Management', 'bio': 'Helps clients manage blood sugar through sustainable Nigerian meal planning.'},
    {'id': 2, 'name': 'Dr. Tunde Bakare', 'title': 'Clinical Nutritionist', 'specialty': 'Weight Management', 'bio': 'Specializes in gradual, culturally-relevant weight loss and gain plans.'},
    {'id': 3, 'name': 'Mrs. Chiamaka Eze', 'title': 'Sports Nutritionist', 'specialty': 'Fitness & Performance', 'bio': 'Works with active clients on performance-focused meal timing and macros.'}
]
_MEMORY_CONSULTATION_REQUESTS = []
TOKEN_TTL_SECONDS = 3600


def safe_error(err, status=500, log_msg=None):
    """Log the real exception server-side, return a generic message to the client."""
    logger.exception(log_msg or 'Request failed')
    return jsonify({'error': 'Something went wrong processing your request.'}), status


@app.route('/')
def landing_page():
    return send_from_directory(WWW_DIR, 'landing.html')


@app.route('/app')
def app_page():
    return send_from_directory(WWW_DIR, 'index.html')


@app.route('/health')
@app.route('/api/health')
def health_check():
    return jsonify({'status': 'ok', 'service': 'bheemz-kitchen-app'}), 200


def paystack_request(path, payload=None, method='GET'):
    if not PAYSTACK_SECRET_KEY:
        raise RuntimeError('PAYSTACK_SECRET_KEY is not configured.')

    headers = {
        'Authorization': f'Bearer {PAYSTACK_SECRET_KEY}',
        'Content-Type': 'application/json',
        # Cloudflare (which sits in front of api.paystack.co) blocks requests
        # with urllib's default "Python-urllib/x.y" User-Agent as bot traffic
        # and returns error 1010. A normal-looking UA avoids that.
        'User-Agent': 'BheemzKitchen/1.0 (+https://bheemzkitchen.example)',
        'Accept': 'application/json'
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')

    request_obj = urllib.request.Request(
        f'{PAYSTACK_BASE_URL}{path}',
        data=data,
        headers=headers,
        method=method
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8')
        try:
            return json.loads(body)
        except Exception:
            return {'status': False, 'message': body}
    except urllib.error.URLError as exc:
        # Network failure talking to Paystack - don't let this crash as a 500
        # with a traceback; surface it as a handled error.
        return {'status': False, 'message': f'Could not reach Paystack: {exc.reason}'}


def flutterwave_request(path, payload=None, method='GET'):
    if not FLUTTERWAVE_SECRET_KEY:
        raise RuntimeError('FLUTTERWAVE_SECRET_KEY is not configured.')

    headers = {
        'Authorization': f'Bearer {FLUTTERWAVE_SECRET_KEY}',
        'Content-Type': 'application/json',
        'User-Agent': 'BheemzKitchen/1.0 (+https://bheemzkitchen.example)',
        'Accept': 'application/json'
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')

    request_obj = urllib.request.Request(
        f'{FLUTTERWAVE_BASE_URL}{path}',
        data=data,
        headers=headers,
        method=method
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8')
        try:
            return json.loads(body)
        except Exception:
            return {'status': False, 'message': body}
    except urllib.error.URLError as exc:
        return {'status': False, 'message': f'Could not reach Flutterwave: {exc.reason}'}


def is_invalid_gateway_key_error(result):
    message = str((result or {}).get('message') or (result or {}).get('error') or '').lower()
    return any(token in message for token in ['invalid authorization key', 'invalid secret key', 'unauthorized', 'authentication failed'])


@app.route('/api/paystack/initialize', methods=['POST'])
def initialize_paystack():
    data = request.json or {}
    email = data.get('email')
    amount = data.get('amount')

    if not email or not amount:
        return jsonify({'error': 'Email and amount are required.'}), 400

    reference = data.get('reference') or f"demo-{int(time.time())}"
    if not REFERENCE_RE.match(reference):
        return jsonify({'error': 'A valid reference is required.'}), 400

    _REFERENCE_METADATA[reference] = {
        'user_id': session.get('user_id'),
        'items': data.get('items', []),
        'amount': data.get('amount'),
        'email': email,
        'phone': data.get('phone', ''),
        'name': data.get('name', '')
    }

    if not PAYSTACK_SECRET_KEY:
        _DEMO_REFERENCES.add(reference)
        return jsonify({
            'status': 'success',
            'authorization_url': f'{request.host_url}api/paystack/mock-checkout?reference={reference}',
            'reference': reference
        }), 200

    try:
        result = paystack_request('/transaction/initialize', {
            'email': email,
            'amount': amount,
            'currency': 'NGN',
            'callback_url': PAYSTACK_CALLBACK_URL,
            'metadata': data.get('metadata', {})
        }, method='POST')
    except RuntimeError as err:
        return safe_error(err, log_msg='Paystack initialize failed')

    if result.get('status'):
        return jsonify({
            'status': 'success',
            'authorization_url': result['data']['authorization_url'],
            'reference': result['data']['reference']
        }), 200

    return jsonify({'error': result.get('message', 'Unable to initialize Paystack payment')}), 400


@app.route('/api/paystack/verify', methods=['POST'])
def verify_paystack():
    data = request.json or {}
    reference = data.get('reference', '')

    if not reference or not REFERENCE_RE.match(reference):
        return jsonify({'error': 'A valid reference is required.'}), 400

    # Only trust demo references this server actually issued.
    if reference.startswith('demo-'):
        if reference in _DEMO_REFERENCES:
            metadata = _REFERENCE_METADATA.get(reference, {})
            order = _persist_order(reference, 'paystack', metadata)
            return jsonify({'status': 'success', 'data': {'reference': reference, 'status': 'success'}, 'order': order}), 200
        return jsonify({'status': 'pending', 'error': 'Unknown reference.'}), 400

    try:
        result = paystack_request(f'/transaction/verify/{reference}', method='GET')
    except RuntimeError as err:
        return safe_error(err, log_msg='Paystack verify failed')

    if result.get('status') and result.get('data', {}).get('status') == 'success':
        metadata = _REFERENCE_METADATA.get(reference, {})
        order = _persist_order(reference, 'paystack', metadata)
        return jsonify({'status': 'success', 'data': result['data'], 'order': order}), 200

    return jsonify({'status': 'pending', 'error': result.get('message', 'Payment not yet confirmed')}), 400


@app.route('/api/paystack/mock-checkout')
def mock_checkout():
    reference = request.args.get('reference', '')
    if not REFERENCE_RE.match(reference):
        return jsonify({'error': 'Invalid reference.'}), 400

    # json.dumps safely escapes the value for embedding inside a <script> block
    # (handles quotes, backslashes, etc. - no manual string interpolation into JS/HTML).
    safe_reference_js = json.dumps(reference)
    return f"""
    <html><body style='font-family:sans-serif; padding:24px;'>
        <h3>Demo Paystack Checkout</h3>
        <p>Payment simulation is active because no live Paystack secret key is configured.</p>
        <button onclick="window.close()">Complete demo payment</button>
        <script>
            window.addEventListener('load', () => {{
                window.opener && window.opener.postMessage({{type:'paystack-demo', reference:{safe_reference_js} }}, window.location.origin);
            }});
        </script>
    </body></html>
    """


@app.route('/api/paystack/callback')
def paystack_callback():
    reference = request.args.get('reference', '')
    if not REFERENCE_RE.match(reference):
        return jsonify({'error': 'Invalid reference.'}), 400

    # Redirect to a configurable frontend URL rather than a hardcoded local
    # file:// path (which only works on one machine and is blocked by most
    # browsers when navigated to from an http(s) page).
    return redirect(f'{FRONTEND_SUCCESS_URL}?payment=success&reference={reference}')


@app.route('/api/flutterwave/initialize', methods=['POST'])
def initialize_flutterwave():
    data = request.json or {}
    email = data.get('email')
    amount = data.get('amount')

    if not email or not amount:
        return jsonify({'error': 'Email and amount are required.'}), 400

    reference = data.get('reference') or f"flw-{int(time.time())}"
    if not REFERENCE_RE.match(reference):
        return jsonify({'error': 'A valid reference is required.'}), 400

    _REFERENCE_METADATA[reference] = {
        'user_id': session.get('user_id'),
        'items': data.get('items', []),
        'amount': data.get('amount'),
        'email': email,
        'phone': data.get('phone', ''),
        'name': data.get('name', '')
    }

    if not FLUTTERWAVE_SECRET_KEY:
        _DEMO_REFERENCES.add(reference)
        return jsonify({
            'status': 'success',
            'authorization_url': f'{request.host_url}api/flutterwave/mock-checkout?reference={reference}',
            'reference': reference
        }), 200

    try:
        result = flutterwave_request('/v3/payments', {
            'tx_ref': reference,
            'amount': int(amount),
            'currency': 'NGN',
            'redirect_url': FLUTTERWAVE_CALLBACK_URL,
            'customer': {
                'email': email,
                'phonenumber': data.get('phone', ''),
                'name': data.get('name', '')
            },
            'customizations': {
                'title': 'Bheemz Kitchen',
                'description': 'Meal plan checkout'
            },
            'meta': data.get('metadata', {})
        }, method='POST')
    except RuntimeError as err:
        return safe_error(err, log_msg='Flutterwave initialize failed')

    if is_invalid_gateway_key_error(result):
        _DEMO_REFERENCES.add(reference)
        return jsonify({
            'status': 'success',
            'authorization_url': f'{request.host_url}api/flutterwave/mock-checkout?reference={reference}',
            'reference': reference,
            'demo_fallback': True,
            'message': 'Flutterwave credentials are invalid or expired; demo checkout fallback was used.'
        }), 200

    if result.get('status') == 'success':
        auth_url = (result.get('data') or {}).get('link') or (result.get('data') or {}).get('redirect_url') or (result.get('data') or {}).get('authorization_url')
        return jsonify({'status': 'success', 'authorization_url': auth_url, 'reference': reference}), 200

    return jsonify({'error': result.get('message', 'Unable to initialize Flutterwave payment')}), 400


@app.route('/api/flutterwave/verify', methods=['POST'])
def verify_flutterwave():
    data = request.json or {}
    reference = data.get('reference', '')

    if not reference or not REFERENCE_RE.match(reference):
        return jsonify({'error': 'A valid reference is required.'}), 400

    if reference in _DEMO_REFERENCES:
        metadata = _REFERENCE_METADATA.get(reference, {})
        order = _persist_order(reference, 'flutterwave', metadata)
        return jsonify({'status': 'success', 'data': {'reference': reference, 'status': 'successful'}, 'order': order}), 200

    try:
        result = flutterwave_request(f'/v3/transactions/{reference}/verify', method='GET')
    except RuntimeError as err:
        return safe_error(err, log_msg='Flutterwave verify failed')

    if result.get('status') == 'success' and str(result.get('data', {}).get('status', '')).lower() in {'successful', 'success'}:
        metadata = _REFERENCE_METADATA.get(reference, {})
        order = _persist_order(reference, 'flutterwave', metadata)
        return jsonify({'status': 'success', 'data': result['data'], 'order': order}), 200

    return jsonify({'status': 'pending', 'error': result.get('message', 'Payment not yet confirmed')}), 400


@app.route('/api/flutterwave/mock-checkout')
def flutterwave_mock_checkout():
    reference = request.args.get('reference', '')
    if not REFERENCE_RE.match(reference):
        return jsonify({'error': 'Invalid reference.'}), 400

    safe_reference_js = json.dumps(reference)
    return f"""
    <html><body style='font-family:sans-serif; padding:24px;'>
        <h3>Demo Flutterwave Checkout</h3>
        <p>Payment simulation is active because no live Flutterwave secret key is configured.</p>
        <button onclick="window.close()">Complete demo payment</button>
        <script>
            window.addEventListener('load', () => {{
                window.opener && window.opener.postMessage({{type:'flutterwave-demo', reference:{safe_reference_js} }}, window.location.origin);
            }});
        </script>
    </body></html>
    """


@app.route('/api/flutterwave/callback')
def flutterwave_callback():
    reference = request.args.get('reference', '') or request.args.get('tx_ref', '') or request.args.get('trxref', '')
    if not reference:
        reference = request.args.get('transaction_id', '')

    if not reference or not REFERENCE_RE.match(reference):
        return jsonify({'error': 'Invalid reference.'}), 400

    return redirect(f'{FRONTEND_SUCCESS_URL}?payment=success&reference={reference}')


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'Authentication required.'}), 401
        return view(*args, **kwargs)
    return wrapped


def _get_user_account_record(user_id):
    account = _MEMORY_BANK_ACCOUNTS.get(user_id)
    if account is None:
        account = {
            'user_id': user_id,
            'account_id': f'bank-account-{user_id}',
            'balance': 250000,
            'currency': 'NGN'
        }
        _MEMORY_BANK_ACCOUNTS[user_id] = account
    return account


def _record_bank_transaction(transaction_type, user_id, amount, account_id, status='completed'):
    tx = {
        'transaction_id': f'{transaction_type}-{int(time.time())}-{user_id}',
        'user_id': user_id,
        'type': transaction_type,
        'status': status,
        'amount': amount,
        'account': account_id,
        'created_at': int(time.time())
    }
    _MEMORY_BANK_TRANSACTIONS.append(tx)
    return tx


def _issue_token(prefix, email, user_id=None):
    token = f'{prefix}-{secrets.token_urlsafe(16)}'
    expires_at = int(time.time()) + TOKEN_TTL_SECONDS
    record = {
        'token': token,
        'email': email,
        'user_id': user_id,
        'expires_at': expires_at,
        'created_at': int(time.time()),
        'used': False
    }
    return token, expires_at, record


def _get_memory_user_by_email(email):
    return next((user for user in _MEMORY_USERS if user['email_address'] == email), None)


def _get_user_by_email(email):
    user = _get_memory_user_by_email(email)
    if user or not DATABASE_ENABLED:
        return user
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                'SELECT id, full_name, email_address, delivery_address, phone_number, password_hash, email_verified FROM users WHERE email_address = %s',
                (email,)
            )
            return cur.fetchone()
    except Exception:
        logger.exception('Could not find user by email')
        return None


# def _persist_order(reference, payment_method, metadata=None):
#     metadata = metadata or {}
#     user_id = metadata.get('user_id') or session.get('user_id')
#     items = metadata.get('items') or metadata.get('cart_items') or []
#     amount = metadata.get('amount')
#     if amount is None and items:
#         amount = sum(float(item.get('price', 0)) * int(item.get('quantity', 1)) for item in items)

#     order = {
#         'id': len(_MEMORY_ORDERS) + 1,
#         'reference': reference,
#         'payment_method': payment_method,
#         'user_id': user_id,
#         'status': 'paid',
#         'amount': amount or 0,
#         'currency': 'NGN',
#         'items': items,
#         'created_at': int(time.time())
#     }
    _MEMORY_ORDERS.append(order)
    return order

def _persist_order(reference, payment_method, metadata=None):
    metadata = metadata or {}
    user_id = metadata.get('user_id') or session.get('user_id')
    items = metadata.get('items') or metadata.get('cart_items') or []
    amount = metadata.get('amount')
    if amount is None and items:
        amount = sum(float(item.get('price', 0)) * int(item.get('quantity', 1)) for item in items)

    order = {
        'id': len(_MEMORY_ORDERS) + 1,
        'reference': reference,
        'payment_method': payment_method,
        'user_id': user_id,
        'status': 'paid',
        'amount': amount or 0,
        'currency': 'NGN',
        'items': items,
        'created_at': int(time.time())
    }
    _MEMORY_ORDERS.append(order)

    # Send order confirmation email
    if user_id:
        user = next((u for u in _MEMORY_USERS if u['id'] == user_id), None)
        if user and user.get('email_address'):
            items_list = "\n".join([f"- {item.get('name', 'Item')} (₦{item.get('price', 0)})" for item in items])
            email_body = f"""
            Thank you for your order at Bheemz Kitchen!

            Order Reference: {reference}
            Amount: ₦{amount}
            Items:
            {items_list}

            Your order will be processed shortly.
            """
            send_email(
                user['email_address'],
                "Your Bheemz Kitchen Order Confirmation",
                email_body
            )

    return order

@app.route('/api/cart', methods=['POST'])
@login_required
def save_cart():
    data = request.json or {}
    items = data.get('items') or []
    if not items:
        return jsonify({'error': 'At least one cart item is required.'}), 400

    user_id = session['user_id']
    cart = {
        'id': len(_MEMORY_CARTS) + 1,
        'user_id': user_id,
        'items': items,
        'updated_at': int(time.time())
    }
    _MEMORY_CARTS[user_id] = cart
    return jsonify({'status': 'success', 'cart': cart}), 200


@app.route('/api/orders', methods=['GET'])
@login_required
def list_orders():
    user_id = session['user_id']
    orders = [order for order in _MEMORY_ORDERS if order.get('user_id') == user_id]
    return jsonify({'status': 'success', 'orders': orders}), 200


@app.route('/api/bank/transfer', methods=['POST'])
@login_required
def bank_transfer():
    data = request.json or {}
    amount = data.get('amount')
    account = data.get('account')
    if amount in (None, '') or not account:
        return jsonify({'error': 'Account and amount are required.'}), 400

    user_id = session['user_id']
    source_account = _get_user_account_record(user_id)
    if str(account) != str(source_account['account_id']):
        return jsonify({'error': 'Not authorized for this account.'}), 403

    amount_value = float(amount)
    if amount_value <= 0:
        return jsonify({'error': 'Amount must be greater than zero.'}), 400
    if amount_value > source_account['balance']:
        return jsonify({'error': 'Insufficient funds.'}), 400

    source_account['balance'] -= amount_value
    tx = _record_bank_transaction('bank_transfer', user_id, amount_value, account)
    return jsonify({'status': 'success', 'transaction': tx, 'balance': source_account['balance']}), 200


@app.route('/api/bank/withdraw', methods=['POST'])
@login_required
def bank_withdraw():
    data = request.json or {}
    amount = data.get('amount')
    account = data.get('account')

    if amount in (None, '') or not account:
        return jsonify({'error': 'Account and amount are required.'}), 400

    user_id = session['user_id']
    account_record = _get_user_account_record(user_id)
    if str(account) != str(account_record['account_id']):
        return jsonify({'error': 'Not authorized for this account.'}), 403

    amount_value = float(amount)
    if amount_value <= 0:
        return jsonify({'error': 'Amount must be greater than zero.'}), 400
    if amount_value > account_record['balance']:
        return jsonify({'error': 'Insufficient funds.'}), 400

    account_record['balance'] -= amount_value
    tx = _record_bank_transaction('bank_withdraw', user_id, amount_value, account)
    return jsonify({'status': 'success', 'transaction': tx, 'balance': account_record['balance']}), 200


@app.route('/api/bank/balance', methods=['GET'])
@login_required
def bank_balance():
    user_id = session['user_id']
    account = _get_user_account_record(user_id)
    return jsonify({'status': 'success', 'balance': account['balance'], 'currency': account['currency']}), 200


# --- Database -----------------------------------------------------------

_db_pool = None


def get_db_pool():
    global _db_pool
    if not DATABASE_ENABLED:
        raise RuntimeError('PostgreSQL is not configured.')
    connection_settings = {
        'database': os.getenv('DB_NAME', 'bheemz_db'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'postgres'),
        'host': os.getenv('DB_HOST', 'localhost'),
        'port': os.getenv('DB_PORT', '5432')
    }
    if DATABASE_URL:
        parsed_database_url = urlparse(DATABASE_URL)
        connection_settings = {'dsn': DATABASE_URL}
        if parsed_database_url.hostname and parsed_database_url.hostname.endswith('.render.com'):
            connection_settings['sslmode'] = 'require'
    if _db_pool is None:
        _db_pool = pg_pool.SimpleConnectionPool(
            1, 10,
            **connection_settings
        )
    return _db_pool


@contextmanager
def db_cursor(dict_cursor=True):
    """Borrows a connection from the pool, commits/rolls back correctly,
    and always returns the connection to the pool - no leaked connections
    on error paths."""
    conn = get_db_pool().getconn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor if dict_cursor else None)
        try:
            yield conn, cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
    finally:
        get_db_pool().putconn(conn)


@app.route('/api/signup', methods=['POST'])
def system_signup():
    data = request.json or {}
    name = data.get('name')
    phone = data.get('phone')
    email = data.get('email')
    password = data.get('pass')
    address = data.get('address')

    if not all([name, phone, email, password]):
        return jsonify({'error': 'Name, phone, email and password are required.'}), 400

    if bcrypt is None:
        return jsonify({'error': 'Password hashing library is unavailable.'}), 500
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    if not DATABASE_ENABLED:
        existing = next((user for user in _MEMORY_USERS if user['email_address'] == email), None)
        if existing:
            return jsonify({'error': 'An account with that email already exists.'}), 409

        user_record = {
            'id': len(_MEMORY_USERS) + 1,
            'full_name': name,
            'email_address': email,
            'delivery_address': address,
            'phone_number': phone,
            'password_hash': hashed,
            'email_verified': False
        }
        _MEMORY_USERS.append(user_record)
        token, expires_at, verification_record = _issue_token('verify', email, user_id=user_record['id'])
        _MEMORY_EMAIL_VERIFICATION_TOKENS[token] = verification_record
        verify_link = f'{FRONTEND_SUCCESS_URL}?verify_token={token}'
        email_sent = send_email(
            email,
            'Verify your Bheemz Kitchen account',
            f'Welcome to Bheemz Kitchen! Please confirm your email by clicking this link:\n\n{verify_link}\n\nThis link expires in 1 hour.'
        )
        user_response = {
            'id': user_record['id'],
            'full_name': user_record['full_name'],
            'email_address': user_record['email_address'],
            'delivery_address': user_record['delivery_address'],
            'email_verified': user_record.get('email_verified', False)
        }
        return jsonify({
            'message': 'Account created securely',
            'user': user_response,
            'verification_token': token,
            'email_sent': email_sent,
            'verification_link': verify_link
        }), 201

    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                '''INSERT INTO users (full_name, phone_number, email_address, password_hash, delivery_address)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id, full_name, email_address, delivery_address;''',
                (name, phone, email, hashed, address)
            )
            user_record = cur.fetchone()
        token, expires_at, verification_record = _issue_token('verify', email, user_id=user_record['id'])
        _MEMORY_EMAIL_VERIFICATION_TOKENS[token] = verification_record
        verify_link = f'{FRONTEND_SUCCESS_URL}?verify_token={token}'
        email_sent = send_email(
            email,
            'Verify your Bheemz Kitchen account',
            f'Welcome to Bheemz Kitchen! Please confirm your email by clicking this link:\n\n{verify_link}\n\nThis link expires in 1 hour.'
        )
        user_record['email_verified'] = False
        return jsonify({
            'message': 'Account created securely',
            'user': user_record,
            'verification_token': token,
            'email_sent': email_sent,
            'verification_link': verify_link
        }), 201
    except Exception as err:
        if psycopg2 is not None and isinstance(err, psycopg2.IntegrityError):
            return jsonify({'error': 'An account with that email already exists.'}), 409
        return safe_error(err, log_msg='Signup failed')


@app.route('/api/login', methods=['POST'])
def login_user():
    data = request.json or {}
    email = data.get('email')
    password = data.get('pass')

    if not all([email, password]):
        return jsonify({'error': 'Email and password are required.'}), 400

    if not DATABASE_ENABLED:
        user_record = next((user for user in _MEMORY_USERS if user['email_address'] == email), None)
        if not user_record:
            return jsonify({'error': 'Invalid credentials.'}), 401

        if bcrypt and bcrypt.checkpw(password.encode('utf-8'), user_record['password_hash'].encode('utf-8')):
            if not user_record.get('email_verified', False):
                return jsonify({'error': 'Please verify your email before logging in.'}), 403
            session['user_id'] = user_record['id']
            response_user = {
                'id': user_record['id'],
                'full_name': user_record['full_name'],
                'email_address': user_record['email_address'],
                'delivery_address': user_record['delivery_address'],
                'email_verified': user_record.get('email_verified', False)
            }
            return jsonify({'message': 'Login successful', 'user': response_user}), 200

        return jsonify({'error': 'Invalid credentials.'}), 401

    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                'SELECT id, full_name, email_address, password_hash, delivery_address FROM users WHERE email_address = %s',
                (email,)
            )
            user_record = cur.fetchone()

        if not user_record:
            # Same message as "wrong password" so this endpoint doesn't reveal
            # which emails are registered.
            return jsonify({'error': 'Invalid credentials.'}), 401

        if bcrypt and bcrypt.checkpw(password.encode('utf-8'), user_record['password_hash'].encode('utf-8')):
            if not user_record.get('email_verified', False):
                return jsonify({'error': 'Please verify your email before logging in.'}), 403
            user_record.pop('password_hash', None)
            session['user_id'] = user_record['id']
            return jsonify({'message': 'Login successful', 'user': user_record}), 200

        return jsonify({'error': 'Invalid credentials.'}), 401
    except Exception as err:
        return safe_error(err, log_msg='Login failed')


@app.route('/api/logout', methods=['POST'])
def logout_user():
    session.pop('user_id', None)
    return jsonify({'message': 'Logged out.'}), 200


@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.json or {}
    email = data.get('email')
    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    user = _get_user_by_email(email)
    token, expires_at, record = _issue_token('reset', email, user_id=user['id'] if user else None)
    _MEMORY_PASSWORD_RESET_REQUESTS.append({'email': email, 'token': token, 'created_at': int(time.time()), 'expires_at': expires_at})
    _MEMORY_PASSWORD_RESET_TOKENS[token] = record

    if user:
        reset_link = f'{FRONTEND_SUCCESS_URL}?reset_token={token}'
        send_email(
            email,
            'Reset your Bheemz Kitchen password',
            f'Click this link to reset your password:\n\n{reset_link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.'
        )

    return jsonify({
        'message': 'If this email exists, a reset link has been sent.',
        'delivery': {
            'provider': 'demo',
            'method': 'email',
            'token': token,
            'expires_at': expires_at
        }
    }), 200

@app.route('/api/reset-password/confirm', methods=['POST'])
def confirm_reset_password():
    data = request.json or {}
    token = data.get('token')
    new_password = data.get('new_password')

    if not token or not new_password:
        return jsonify({'error': 'Token and new_password are required.'}), 400

    record = _MEMORY_PASSWORD_RESET_TOKENS.get(token)
    if not record or record.get('used'):
        return jsonify({'error': 'Invalid or expired reset token.'}), 400

    if record['expires_at'] < int(time.time()):
        return jsonify({'error': 'Invalid or expired reset token.'}), 400

    user = _get_user_by_email(record['email'])
    if not user:
        return jsonify({'error': 'Invalid or expired reset token.'}), 400

    if bcrypt is None:
        return jsonify({'error': 'Password hashing library is unavailable.'}), 500

    hashed_password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    if DATABASE_ENABLED:
        try:
            with db_cursor(dict_cursor=False) as (conn, cur):
                cur.execute('UPDATE users SET password_hash = %s WHERE id = %s', (hashed_password, user['id']))
        except Exception as err:
            return safe_error(err, log_msg='Password reset update failed')
    else:
        user['password_hash'] = hashed_password
    record['used'] = True
    return jsonify({'message': 'Password reset successful.'}), 200


@app.route('/api/verify-email', methods=['POST'])
def verify_email():
    data = request.json or {}
    email = data.get('email')
    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    user = _get_user_by_email(email)
    token, expires_at, record = _issue_token('verify', email, user_id=user['id'] if user else None)
    _MEMORY_EMAIL_VERIFICATIONS[email] = {
        'verified': False,
        'verification_id': token,
        'expires_at': expires_at,
        'verified_at': None
    }
    _MEMORY_EMAIL_VERIFICATION_TOKENS[token] = record

    verify_link = f'{FRONTEND_SUCCESS_URL}?verify_token={token}'
    email_sent = send_email(
        email,
        'Verify your Bheemz Kitchen account',
        f'Welcome to Bheemz Kitchen! Please confirm your email by clicking this link:\n\n{verify_link}\n\nThis link expires in 1 hour.'
    )

    return jsonify({
        'message': 'Verification email sent.' if email_sent else 'Verification token created (email not sent — SMTP not configured).',
        'delivery': {
            'provider': 'gmail' if email_sent else 'demo',
            'method': 'email',
            'token': token,
            'expires_at': expires_at
        }
    }), 200


@app.route('/api/verify-email/confirm', methods=['POST'])
def confirm_email_verification():
    data = request.json or {}
    token = data.get('token')
    if not token:
        return jsonify({'error': 'Token is required.'}), 400

    record = _MEMORY_EMAIL_VERIFICATION_TOKENS.get(token)
    if not record or record.get('used'):
        return jsonify({'error': 'Invalid or expired verification token.'}), 400

    if record['expires_at'] < int(time.time()):
        return jsonify({'error': 'Invalid or expired verification token.'}), 400

    user = _get_user_by_email(record['email'])
    if not user:
        return jsonify({'error': 'Invalid or expired verification token.'}), 400

    if DATABASE_ENABLED:
        try:
            with db_cursor(dict_cursor=False) as (conn, cur):
                cur.execute('UPDATE users SET email_verified = TRUE WHERE id = %s', (user['id'],))
        except Exception as err:
            return safe_error(err, log_msg='Email verification update failed')
    else:
        user['email_verified'] = True
    _MEMORY_EMAIL_VERIFICATIONS[record['email']] = {
        'verified': True,
        'verification_id': token,
        'expires_at': record['expires_at'],
        'verified_at': int(time.time())
    }
    record['used'] = True
    return jsonify({'message': 'Email verification confirmed.'}), 200


@app.route('/api/profile', methods=['POST'])
@login_required
def save_profile():
    data = request.json or {}

    required = ['age', 'weight', 'height', 'gender', 'goal', 'challenge', 'preference']
    missing = [f for f in required if data.get(f) in (None, '')]
    if missing:
        return jsonify({'error': f'Missing required field(s): {", ".join(missing)}'}), 400

    # userId now comes from the authenticated session, not the request body -
    # otherwise any logged-in user could overwrite anyone else's profile by
    # passing a different userId.
    user_id = session['user_id']

    if not DATABASE_ENABLED:
        _MEMORY_PROFILES[user_id] = {
            'age': data['age'],
            'weight': data['weight'],
            'height': data['height'],
            'gender': data['gender'],
            'goal': data['goal'],
            'challenge': data['challenge'],
            'preference': data['preference'],
            'expectedCalories': data.get('expectedCalories')
        }
        return jsonify({'status': 'Health metrics logged successfully'}), 200

    try:
        with db_cursor(dict_cursor=False) as (conn, cur):
            cur.execute(
                '''INSERT INTO profiles (user_id, age, weight, height, gender, health_goal, health_challenge, dietary_preference)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id) DO UPDATE SET
                   age=EXCLUDED.age, weight=EXCLUDED.weight, height=EXCLUDED.height,
                   health_goal=EXCLUDED.health_goal, health_challenge=EXCLUDED.health_challenge, dietary_preference=EXCLUDED.dietary_preference;''',
                (user_id, data['age'], data['weight'], data['height'], data['gender'], data['goal'], data['challenge'], data['preference'])
            )
        return jsonify({'status': 'Health metrics logged successfully'}), 200
    except Exception as err:
        return safe_error(err, log_msg='Profile save failed')

@app.route('/api/experts', methods=['GET'])
def list_experts():
    return jsonify(_MEMORY_EXPERTS), 200


@app.route('/api/consultations', methods=['POST'])
@login_required
def request_consultation():
    data = request.json or {}
    expert_id = data.get('expert_id')
    message = data.get('message', '')

    expert = next((e for e in _MEMORY_EXPERTS if e['id'] == expert_id), None)
    if not expert:
        return jsonify({'error': 'Selected expert not found.'}), 400

    request_record = {
        'id': len(_MEMORY_CONSULTATION_REQUESTS) + 1,
        'user_id': session['user_id'],
        'expert_id': expert_id,
        'expert_name': expert['name'],
        'message': message,
        'status': 'pending',
        'created_at': int(time.time())
    }
    _MEMORY_CONSULTATION_REQUESTS.append(request_record)
    return jsonify({'status': 'success', 'message': 'Request received — an expert will reach out within 24 hours.', 'request': request_record}), 201

@app.route('/api/meals', methods=['GET'])
def get_filtered_meals():
    challenge = request.args.get('challenge', 'None')
    category = request.args.get('category', 'All')



    if not DATABASE_ENABLED:
        meals = [
            {
                'id': 1,
                'name': 'Unripe Plantain Amala & Ewedu',
                'meal_category': 'Lunch',
                'calories': '380 kcal',
                'protein': '14g',
                'carbs': '45g',
                'fats': '4g',
                'portion': 'Standard serving',
                'price': 3500,
                'benefits': 'Low-glycemic alternative swallow',
                'labels': ['Low Sodium', 'No Maggi Added', 'Naturally Seasoned'],
                'recipeSummary': 'A balanced low-sodium swallow paired with nutrient-rich ewedu.',
                'recipeDetails': {
                    'duration': '45 minutes',
                    'ingredients': ['2 cups unripe plantain flour', '1 bunch ewedu leaves', '1 tsp locust bean', '1 small onion', '1 liter water', '1 tbsp low-salt seasoning', 'Fresh pepper and ginger to taste'],
                    'steps': ['Boil 1 liter of water until steaming.', 'Add finely chopped onion, ginger and locust bean to the water.', 'Slowly stir in plantain flour until smooth to make amala.', 'Blend ewedu leaves with a little water until slippery.', 'Simmer the blended ewedu mixture with low-salt seasoning and pepper for 10 minutes.', 'Serve amala hot with the ewedu soup and fresh vegetables.'],
                    'notes': 'Use minimal salt and natural spices to keep this meal heart-friendly.'
                },
                'targetChallenge': 'Diabetes'
            },
            {
                'id': 2,
                'name': 'Oat Fufu & Low-Salt Okra Soup',
                'meal_category': 'Dinner',
                'calories': '410 kcal',
                'protein': '22g',
                'carbs': '52g',
                'fats': '6g',
                'portion': 'Controlled single serve',
                'price': 4000,
                'benefits': 'High cardiovascular fiber retention',
                'labels': ['Low Sodium', 'Heart Friendly'],
                'recipeSummary': 'A low-oil, nutrient-dense fufu and soup pairing for healthy digestion.',
                'recipeDetails': {
                    'duration': '40 minutes',
                    'ingredients': ['1 cup oat flour', '2 cups water', '1 cup chopped okra', '1 medium tomato', '1 small onion', '1 piece smoked fish', '1 tsp natural seasoning', '1 tbsp palm oil'],
                    'steps': ['Bring 2 cups of water to a boil.', 'Whisk in oat flour gradually to create smooth fufu.', 'Sauté chopped onion and tomato in a small amount of palm oil.', 'Add okra and smoked fish, then simmer on low heat for 15 minutes.', 'Season with natural spices and a pinch of salt.', 'Serve fufu with the warm okra soup.'],
                    'notes': 'Keep oil low and use smoked fish for natural umami instead of artificial seasoning.'
                },
                'targetChallenge': 'Hypertension'
            },
            {
                'id': 3,
                'name': 'Fruit & Nut Protein Smoothie',
                'meal_category': 'Smoothies',
                'calories': '290 kcal',
                'protein': '18g',
                'carbs': '30g',
                'fats': '2g',
                'portion': '500ml bottle',
                'price': 2500,
                'benefits': 'Antioxidant cellular cleansing',
                'labels': ['Naturally Seasoned', 'Low Sodium'],
                'recipeSummary': 'A refreshing smoothie with natural spices and no added artificial sweeteners.',
                'recipeDetails': {
                    'duration': '10 minutes',
                    'ingredients': ['1 ripe banana', '1/2 cup berries', '1 tbsp peanut butter', '1/4 cup oats', '1 cup almond milk', '1/4 tsp ground ginger', '1/4 tsp cinnamon', '1 tsp honey'],
                    'steps': ['Add banana, berries, peanut butter and oats to a blender.', 'Pour in almond milk and blend until smooth.', 'Add ginger, cinnamon and honey, then blend again.', 'Pour into a glass and enjoy chilled.'],
                    'notes': 'This smoothie is naturally sweetened and protein-rich for a healthy snack.'
                },
                'targetChallenge': 'None'
            }
        ]

        filtered = meals
        if challenge != 'None':
            filtered = [meal for meal in filtered if meal.get('targetChallenge') == challenge or meal.get('targetChallenge') == 'None']
        if category != 'All':
            filtered = [meal for meal in filtered if meal.get('meal_category') == category]
        return jsonify(filtered)

    try:
        with db_cursor() as (conn, cur):
            query = 'SELECT * FROM meals WHERE 1=1'
            params = []
            if challenge != 'None':
                query += ' AND health_challenge_tag = %s'
                params.append(challenge)
            if category != 'All':
                query += ' AND meal_category = %s'
                params.append(category)

            cur.execute(query, tuple(params))
            records = cur.fetchall()
            for record in records:
                if isinstance(record.get('labels'), str):
                    record['labels'] = [item.strip() for item in record['labels'].split(',')]
                if record.get('price') is not None:
                    record['price'] = float(record['price'])
                record['category'] = record.get('meal_category', 'Other')
            return jsonify(records)
    except Exception as err:
        return safe_error(err, log_msg='Meal fetch failed')

if __name__ == '__main__':
    port = int(os.getenv('PORT', '5003'))
    app.run(debug=DEBUG_MODE, host="0.0.0.0", port=port)
