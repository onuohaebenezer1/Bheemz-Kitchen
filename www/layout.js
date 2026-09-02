const Browser = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.Browser : null;

// In the native Android/iOS app, Browser is provided by Capacitor. When
// running in an ordinary web browser tab (e.g. testing before packaging the
// app), window.Capacitor doesn't exist, so Browser is null and calling
// Browser.open() directly throws. This falls back to a normal new tab in
// that case, so checkout works in both environments.
async function openExternalUrl(url) {
    if (Browser && typeof Browser.open === 'function') {
        await Browser.open({ url });
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

const CapApp = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.App : null;
let lastBackPressTime = 0;

if (CapApp) {
    CapApp.addListener('backButton', () => {
        const openModals = [
            'auth-modal',
            'password-reset-modal',
            'profile-modal',
            'recipe-modal',
            'profile-confirm-overlay',
            'consultation-modal-overlay'
        ];

        for (const modalId of openModals) {
            const modal = document.getElementById(modalId);
            if (modal && getComputedStyle(modal).display !== 'none') {
                modal.style.display = 'none';
                return;
            }
        }

        const activeNav = document.querySelector('.nav-control.active') ? document.querySelector('.nav-control.active').textContent : '';
        const onDashboard = activeNav.includes('Dashboard');

        if (!onDashboard) {
            switchView('dashboard');
            return;
        }

        const now = Date.now();
        if (now - lastBackPressTime < 2000) {
            CapApp.exitApp();
        } else {
            lastBackPressTime = now;
            showToast('Press back again to exit');
        }
    });
}

function resolveBackendUrl() {
    return 'https://bheemz-kitchen-2.onrender.com/api';
}

const BACKEND_URL = resolveBackendUrl();

async function apiFetch(url, options = {}) {
    options.credentials = 'include';
    options.headers = {
        ...(options.headers || {}),
        'ngrok-skip-browser-warning': 'true'
    };
    return fetch(url, options);
}

const LOCAL_USERS_KEY = "bheemzUserAccounts";
var currentAppState = window.currentAppState || {
    user: null,
    healthProfile: null,
    currentCategory: "All",
    cart: [],
    mealLog: [],
    savedAccounts: [],
    paymentReference: null,
    selectedPaymentMethod: 'paystack',
    notificationPreferences: {
        mealReminders: true,
        deliveryUpdates: true,
        renewalReminders: true,
        healthyTips: true
    }
};
window.currentAppState = currentAppState;

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    loadSavedAccounts();
    const storedUser = JSON.parse(localStorage.getItem('bheemzCurrentUser') || 'null');
    const storedProfile = JSON.parse(localStorage.getItem('bheemzCurrentProfile') || 'null');
    currentAppState.user = storedUser;
    currentAppState.healthProfile = storedProfile;
    currentAppState.cart = JSON.parse(localStorage.getItem('bheemzCart') || '[]');
    currentAppState.mealLog = JSON.parse(localStorage.getItem('bheemzMealLog') || '[]');
    currentAppState.selectedPaymentMethod = localStorage.getItem('bheemzPaymentMethod') || 'paystack';
    currentAppState.notificationPreferences = JSON.parse(localStorage.getItem('bheemzNotificationPreferences') || JSON.stringify(currentAppState.notificationPreferences));
    updateAuthHeader();

    const urlParams = new URLSearchParams(window.location.search);
    const verifyToken = urlParams.get('verify_token');

    if (verifyToken) {
        document.getElementById('auth-modal').style.display = 'flex';
        switchAuthTab('login');
        showVerificationPrompt();
        window.pendingVerifyToken = verifyToken;
        const storedTheme = localStorage.getItem('bheemzTheme') || 'light';
        if (storedTheme === 'dark') document.body.classList.add('dark');
        return;
    }

    document.getElementById('auth-modal').style.display = 'none';
    switchView('dashboard');
    const storedTheme = localStorage.getItem('bheemzTheme') || 'light';
    if (storedTheme === 'dark') document.body.classList.add('dark');
}

function showToast(message) {
    let overlay = document.getElementById('toast-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'toast-overlay';
        overlay.innerHTML = '<div class="toast-popup"><p id="toast-message"></p><button id="toast-close-btn">OK</button></div>';
        document.body.appendChild(overlay);
        document.getElementById('toast-close-btn').addEventListener('click', hideToast);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideToast();
        });
    }
    document.getElementById('toast-message').textContent = message;
    overlay.classList.add('show');
}

function hideToast() {
    const overlay = document.getElementById('toast-overlay');
    if (overlay) overlay.classList.remove('show');
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('bheemzTheme', isDark ? 'dark' : 'light');
}

function loadSavedAccounts() {
    currentAppState.savedAccounts = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]');
}

function saveAccounts() {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(currentAppState.savedAccounts));
}

function saveSession() {
    if (currentAppState.user) {
        localStorage.setItem('bheemzCurrentUser', JSON.stringify(currentAppState.user));
    } else {
        localStorage.removeItem('bheemzCurrentUser');
    }
    if (currentAppState.healthProfile) {
        localStorage.setItem('bheemzCurrentProfile', JSON.stringify(currentAppState.healthProfile));
    }
    localStorage.setItem('bheemzCart', JSON.stringify(currentAppState.cart));
    localStorage.setItem('bheemzMealLog', JSON.stringify(currentAppState.mealLog));
    localStorage.setItem('bheemzPaymentMethod', currentAppState.selectedPaymentMethod);
    localStorage.setItem('bheemzNotificationPreferences', JSON.stringify(currentAppState.notificationPreferences));
}

function updateAuthHeader() {
    document.getElementById('user-badge').innerText = currentAppState.user ? `Hello, ${currentAppState.user.name}` : 'Guest Profile';
}

function showAuthModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    switchAuthTab('login');
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab-btn').forEach(btn => btn.classList.toggle('active', btn.id === `tab-${tab}`));
    document.getElementById('login-panel').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('signup-panel').style.display = tab === 'signup' ? 'block' : 'none';
    document.getElementById('email-verify-panel').style.display = 'none';
}

function showPasswordReset() {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('password-reset-modal').style.display = 'flex';
}

function closePasswordReset() {
    document.getElementById('password-reset-modal').style.display = 'none';
    showAuthModal();
}

function populateProfileForm() {
    if (!currentAppState.healthProfile) return;
    document.getElementById('prof-age').value = currentAppState.healthProfile.age || '';
    document.getElementById('prof-weight').value = currentAppState.healthProfile.weight || '';
    document.getElementById('prof-height').value = currentAppState.healthProfile.height || '';
    document.getElementById('prof-gender').value = currentAppState.healthProfile.gender || 'Male';
    document.getElementById('prof-goal').value = currentAppState.healthProfile.goal || 'Weight Loss';
    document.getElementById('prof-challenge').value = currentAppState.healthProfile.challenge || 'None';
    document.getElementById('prof-pref').value = currentAppState.healthProfile.preference || 'Low Salt';
    document.getElementById('prof-expected-calories').value = currentAppState.healthProfile.expectedCalories || '';
}

function showProfileModal() {
    populateProfileForm();
    document.getElementById('profile-modal').style.display = 'flex';
}

function handleLogout() {
    if (!currentAppState.user) {
        showAuthModal();
        return;
    }
    currentAppState.user = null;
    currentAppState.healthProfile = null;
    currentAppState.cart = [];
    document.getElementById('cart-counter').innerText = '0';
    saveSession();
    updateAuthHeader();
    switchView('dashboard');
}

async function handleRegistration() {
    const payload = {
        name: document.getElementById('reg-name').value.trim(),
        phone: document.getElementById('reg-phone').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        pass: document.getElementById('reg-pass').value,
        address: document.getElementById('reg-address').value.trim()
    };

    if (!payload.name || !payload.email || !payload.pass) {
        showToast('Please provide name, email, and password.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            currentAppState.verificationToken = data?.delivery?.token || data?.verification_token || null;
            currentAppState.user = {...data.user, verified: false, password: btoa(payload.pass) };
            storeAccount(payload, currentAppState.user);
            showVerificationPrompt();
            if (!data.email_sent && data.verification_link) {
                showToast(`Email delivery is not configured. Open this verification link: ${data.verification_link}`);
            }
            return;
        }
        showToast(data.error || 'Registration failed.');
    } catch {
        storeAccount(payload);
        currentAppState.user = currentAppState.savedAccounts.find(acc => acc.email === payload.email);
        showVerificationPrompt();
    }
}

function storeAccount(payload, userRecord) {
    const existing = currentAppState.savedAccounts.find(acc => acc.email === payload.email);
    const account = existing || {
        id: userRecord ? userRecord.id || Date.now() : Date.now(),
        name: payload.name,
        email: payload.email,
        password: btoa(payload.pass),
        address: payload.address,
        phone: payload.phone,
        verified: false
    };

    if (!existing) {
        currentAppState.savedAccounts.push(account);
    }
    saveAccounts();
    currentAppState.user = account;
}

function showVerificationPrompt() {
    document.getElementById('login-panel').style.display = 'none';
    document.getElementById('signup-panel').style.display = 'none';
    document.getElementById('email-verify-panel').style.display = 'block';
}

async function completeEmailVerification() {
    const token = currentAppState.verificationToken || window.pendingVerifyToken || new URLSearchParams(window.location.search).get('verify_token');

    if (!token) {
        showAuthModal();
        switchAuthTab('login');
        showToast('No verification token found. Please use the email link or request a new one.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/verify-email/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Email verification failed.');
            return;
        }

        // Prefer the email the backend just verified (works even when this
        // link is opened fresh, with no active session yet) and fall back
        // to the current session's email if the backend didn't send one.
        const verifiedEmail = data.email || currentAppState.user?.email;
        if (verifiedEmail) {
            const account = currentAppState.savedAccounts.find(acc => acc.email === verifiedEmail);
            if (account) {
                account.verified = true;
                saveAccounts();
            }
        }
        if (currentAppState.user && currentAppState.user.email === verifiedEmail) {
            currentAppState.user.verified = true;
            currentAppState.user.email_verified = true;
            saveSession();
        }

        currentAppState.verificationToken = null;
        delete window.pendingVerifyToken;
        const url = new URL(window.location.href);
        url.searchParams.delete('verify_token');
        window.history.replaceState({}, document.title, url.toString());

        document.getElementById('auth-modal').style.display = 'flex';
        switchAuthTab('login');
        updateAuthHeader();
        showToast('Email verified successfully. Please log in to continue.');
    } catch (error) {
        showToast('Could not verify your email right now. Please try again.');
    }
}

async function resendVerification() {
    const email = currentAppState.user?.email || currentAppState.user?.email_address;
    if (!email) {
        showToast('No registered email found to resend verification to.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            currentAppState.verificationToken = data?.delivery?.token || null;
            if (data.email_sent) {
                showToast('Verification email resent. Check your inbox for the link to confirm your account.');
            } else if (data.verification_link) {
                showToast(`Email was not sent. Open this verification link: ${data.verification_link}`);
            } else {
                showToast(data.message || 'SMTP email was not sent. Check the Render SMTP settings.');
            }
            return;
        }

        showToast(data.error || 'Could not resend verification email.');
    } catch (error) {
        showToast(error.message || 'Could not resend verification email.');
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    if (!email || !pass) {
        showToast('Enter both email and password to login.');
        return;
    }

    let account = currentAppState.savedAccounts.find(acc => acc.email === email && acc.password === btoa(pass));
    if (account) {
        if (!account.verified) {
            currentAppState.user = account;
            showVerificationPrompt();
            showToast('Please verify your email before continuing.');
            return;
        }
        currentAppState.user = account;
        saveSession();
        document.getElementById('auth-modal').style.display = 'none';
        updateAuthHeader();
        if (currentAppState.healthProfile) {
            askProfileContinue();
        } else {
            document.getElementById('profile-modal').style.display = 'flex';
        }
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, pass })
        });
        const data = await res.json();
        if (res.ok) {
            currentAppState.user = {...data.user, verified: true, password: btoa(pass) };
            storeAccount({ name: data.user.full_name, email, pass, address: data.user.delivery_address }, currentAppState.user);
            saveSession();
            document.getElementById('auth-modal').style.display = 'none';
            updateAuthHeader();
            if (currentAppState.healthProfile) {
                askProfileContinue();
            } else {
                document.getElementById('profile-modal').style.display = 'flex';
            }
            return;
        }
        showToast(data.error || 'Login failed.');
    } catch {
        showToast('No backend available. Please register locally or check your connection.');
    }
}

function askProfileContinue() {
    const continueWithProfile = showToast('A saved health profile was found. Select OK to continue with it, or Cancel to update your profile.');
    if (continueWithProfile) {
        switchView('dashboard');
    } else {
        document.getElementById('profile-modal').style.display = 'flex';
    }
}

async function handlePasswordReset() {
    const email = document.getElementById('reset-email').value.trim();
    if (!email) {
        showToast('Enter your email to reset your password.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Password reset sent to your email.');
            closePasswordReset();
            return;
        }
    } catch {
        const account = currentAppState.savedAccounts.find(acc => acc.email === email);
        if (account) {
            showToast('Local password reset: use the same email and your current password from registration.');
            closePasswordReset();
            return;
        }
        showToast('No account found for that email.');
    }
}

async function handleProfileSubmit() {
    if (!currentAppState.user) {
        document.getElementById('profile-modal').style.display = 'none';
        showAuthModal();
        return;
    }
    const payload = {
        userId: currentAppState.user.id || 1,
        age: document.getElementById('prof-age').value,
        weight: document.getElementById('prof-weight').value,
        height: document.getElementById('prof-height').value,
        gender: document.getElementById('prof-gender').value,
        goal: document.getElementById('prof-goal').value,
        challenge: document.getElementById('prof-challenge').value,
        preference: document.getElementById('prof-pref').value,
        expectedCalories: parseInt(document.getElementById('prof-expected-calories').value, 10) || 1800
    };

    if (!payload.age || !payload.weight || !payload.height) {
        showToast('Please complete your age, weight, and height to save your profile.');
        return;
    }

    const continueToMenu = () => {
        currentAppState.healthProfile = payload;
        document.getElementById('profile-modal').style.display = 'none';
        document.getElementById('user-badge').innerText = `${payload.goal} • ${payload.challenge} • ${payload.expectedCalories} kcal`;
        saveSession();
        showProfileConfirmedPopup();
    };

    function showProfileConfirmedPopup() {
        let overlay = document.getElementById('profile-confirm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'profile-confirm-overlay';
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML = `
            <div class="auth-card" style="text-align:center;">
                <h2>✅ Profile Active</h2>
                <p>Your health profile is set. Taking you to your dashboard.</p>
                <button onclick="document.getElementById('profile-confirm-overlay').style.display='none'; switchView('dashboard');">Go to Dashboard</button>
            </div>`;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
        }
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error('Profile sync failed');
        }

        continueToMenu();
    } catch {
        continueToMenu();
    }
}

async function apiFetchMealsForProfile(categoryParam = 'All') {
    const challengeParam = currentAppState.healthProfile ? currentAppState.healthProfile.challenge : 'None';
    try {
        const res = await apiFetch(`${BACKEND_URL}/meals?challenge=${encodeURIComponent(challengeParam)}&category=${encodeURIComponent(categoryParam)}`);
        if (!res.ok) throw new Error(`Meals request failed (${res.status})`);
        const meals = await res.json();
        if (!Array.isArray(meals)) throw new Error('Meals response was not a list');
        return meals;
    } catch {
        return [{
            name: 'Fruit & Nut Protein Smoothie',
            category: 'Smoothies',
            calories: '290 kcal',
            protein: '18g',
            carbs: '30g',
            fats: '2g',
            portion: '500ml bottle',
            price: 2500,
            benefits: 'Antioxidant cellular cleansing',
            labels: ['Naturally Seasoned', 'Low Sodium'],
            recipeSummary: 'A refreshing smoothie with natural spices and no added artificial sweeteners.',
            recipeDetails: { duration: '10 minutes', ingredients: [], steps: [], notes: '' },
            targetChallenge: 'None'
        }];
    }
}

async function loadMenuPayload() {
    const container = document.getElementById('main-content-view');
    if (!document.getElementById('menu-target-container')) {
        if (container) {
            container.innerHTML = '<div class="section-title">Tailored Dietary Recommendations</div><div id="menu-target-container"></div>';
        }
    }

    const target = document.getElementById('menu-target-container');
    if (!target) return;
    target.innerHTML = '<p>Analyzing dynamic caloric indexes...</p>';

    const challengeParam = currentAppState.healthProfile ? currentAppState.healthProfile.challenge : 'None';
    const categoryParam = currentAppState.currentCategory || 'All';
    try {
        const res = await apiFetch(`${BACKEND_URL}/meals?challenge=${encodeURIComponent(challengeParam)}&category=${encodeURIComponent(categoryParam)}`);
        const data = await res.json();
        renderMenuCards(data);
    } catch {
        const mockDb = [{
                name: 'Unripe Plantain Amala & Ewedu',
                category: 'Lunch',
                calories: '380 kcal',
                protein: '14g',
                carbs: '45g',
                fats: '4g',
                portion: 'Standard serving',
                price: 3500,
                benefits: 'Low-glycemic alternative swallow',
                labels: ['Low Sodium', 'No Maggi Added', 'Naturally Seasoned'],
                recipeSummary: 'A balanced low-sodium swallow paired with nutrient-rich ewedu.',
                recipeDetails: {
                    duration: '45 minutes',
                    ingredients: ['2 cups unripe plantain flour', '1 bunch ewedu leaves', '1 tsp locust bean', '1 small onion', '1 liter water', '1 tbsp low-salt seasoning', 'Fresh pepper and ginger to taste'],
                    steps: ['Boil 1 liter of water until steaming.', 'Add finely chopped onion, ginger and locust bean to the water.', 'Slowly stir in plantain flour until smooth to make amala.', 'Blend ewedu leaves with a little water until slippery.', 'Simmer the blended ewedu mixture with low-salt seasoning and pepper for 10 minutes.', 'Serve amala hot with the ewedu soup and fresh vegetables.'],
                    notes: 'Use minimal salt and natural spices to keep this meal heart-friendly.'
                },
                targetChallenge: 'Diabetes'
            },
            {
                name: 'Oat Fufu & Low-Salt Okra Soup',
                category: 'Dinner',
                calories: '410 kcal',
                protein: '22g',
                carbs: '52g',
                fats: '6g',
                portion: 'Controlled single serve',
                price: 4000,
                benefits: 'High cardiovascular fiber retention',
                labels: ['Low Sodium', 'Heart Friendly'],
                recipeSummary: 'A low-oil, nutrient-dense fufu and soup pairing for healthy digestion.',
                recipeDetails: {
                    duration: '40 minutes',
                    ingredients: ['1 cup oat flour', '2 cups water', '1 cup chopped okra', '1 medium tomato', '1 small onion', '1 piece smoked fish', '1 tsp natural seasoning', '1 tbsp palm oil'],
                    steps: ['Bring 2 cups of water to a boil.', 'Whisk in oat flour gradually to create smooth fufu.', 'Sauté chopped onion and tomato in a small amount of palm oil.', 'Add okra and smoked fish, then simmer on low heat for 15 minutes.', 'Season with natural spices and a pinch of salt.', 'Serve fufu with the warm okra soup.'],
                    notes: 'Keep oil low and use smoked fish for natural umami instead of artificial seasoning.'
                },
                targetChallenge: 'Hypertension'
            },
            {
                name: 'Fruit & Nut Protein Smoothie',
                category: 'Smoothies',
                calories: '290 kcal',
                protein: '18g',
                carbs: '30g',
                fats: '2g',
                portion: '500ml bottle',
                price: 2500,
                benefits: 'Antioxidant cellular cleansing',
                labels: ['Naturally Seasoned', 'Low Sodium'],
                recipeSummary: 'A refreshing smoothie with natural spices and no added artificial sweeteners.',
                recipeDetails: {
                    duration: '10 minutes',
                    ingredients: ['1 ripe banana', '1/2 cup berries', '1 tbsp peanut butter', '1/4 cup oats', '1 cup almond milk', '1/4 tsp ground ginger', '1/4 tsp cinnamon', '1 tsp honey'],
                    steps: ['Add banana, berries, peanut butter and oats to a blender.', 'Pour in almond milk and blend until smooth.', 'Add ginger, cinnamon and honey, then blend again.', 'Pour into a glass and enjoy chilled.'],
                    notes: 'This smoothie is naturally sweetened and protein-rich for a healthy snack.'
                },
                targetChallenge: 'None'
            }
        ];
        const filtered = mockDb.filter(m => categoryParam === 'All' || m.category === categoryParam);
        renderMenuCards(filtered);
    }
}

function renderMenuCards(meals) {
    const target = document.getElementById('menu-target-container');
    if (!target) return;
    target.innerHTML = '';
    currentAppState.currentMenu = meals;

    meals.forEach((meal, idx) => {
                const card = document.createElement('div');
                card.className = 'meal-container-card';
                card.innerHTML = `
            <div class="meal-core-info">
                <div class="meal-title">
                    <h4>${meal.name}</h4>
                    <p> ${meal.portion} | ₦${meal.price}</p>
                    <p style="color:var(--bheemz-green); font-size:10px; margin-top:2px;">✨ ${meal.benefits}</p>
                </div>
            </div>
            <div class="macro-grid">
                <div class="macro-item"><strong>${meal.calories}</strong>Cal</div>
                <div class="macro-item"><strong>${meal.protein}</strong>Prot</div>
                <div class="macro-item"><strong>${meal.carbs}</strong>Carb</div>
                <div class="macro-item"><strong>${meal.fats}</strong>Fat</div>
            </div>
            <div class="indicator-row">
                ${meal.labels.map(lbl => `<span class="badge-label">${lbl}</span>`).join('')}
            </div>
            <div class="subscription-purchase-block">
                <div class="sub-selectors">
                    <select id="plan-type-${idx}">
                        <option value="Single Purchase">One-time Order</option>
                        <option value="Daily Plan">Daily Plan</option>
                        <option value="Weekly Plan">Weekly Plan (7 Days)</option>
                        <option value="Monthly Plan">Monthly Plan (30 Days)</option>
                    </select>
                </div>
                <div class="action-row">
                <button class="buy-btn" onclick="requireAuthOrPrompt(() => addToCartEngine(${idx}))">Add to Cart</button>
                <button class="log-btn" onclick="requireAuthOrPrompt(() => logMeal(${idx}))">Log Meal</button>
                <button class="recipe-btn" onclick="showRecipeModal(${idx})">View Recipe</button>
                </div>
            </div>
        `;
        target.appendChild(card);
    });
}

function filterCategory(cat, button) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (button) button.classList.add('active');
    currentAppState.currentCategory = cat;
    loadMenuPayload();
}

function addToCartEngine(idx) {
    const meal = currentAppState.currentMenu[idx];
    const selectedPlan = document.getElementById(`plan-type-${idx}`).value;
    currentAppState.cart.push({ meal, plan: selectedPlan });
    document.getElementById('cart-counter').innerText = currentAppState.cart.length;
    saveSession();
    showToast(`${meal.name} added to cart under a ${selectedPlan} option.`);
}

function removeFromCart(idx) {
    const removed = currentAppState.cart[idx];
    currentAppState.cart.splice(idx, 1);
    document.getElementById('cart-counter').innerText = currentAppState.cart.length;
    saveSession();
    showToast(`${removed.meal.name} removed from cart.`);
    renderCartView(document.getElementById('main-content-view'));
}

function logMeal(idx) {
    const meal = currentAppState.currentMenu[idx];
    const loggedMeal = {
        name: meal.name,
        calories: parseInt(meal.calories, 10) || 0,
        loggedAt: new Date().toLocaleString(),
        plan: document.getElementById(`plan-type-${idx}`)?.value || 'Single Purchase'
    };
    currentAppState.mealLog.push(loggedMeal);
    saveSession();
    showToast(`${meal.name} logged to your nutrition tracker.`);
    if (document.querySelector('.nav-control.active')?.textContent.includes('Tracker')) {
        renderTrackerView(document.getElementById('main-content-view'));
    }
}

function renderCartView(container) {
    if (currentAppState.cart.length === 0) {
        container.innerHTML = `<div class="section-title">Your Cart</div><p>Cart is currently empty.</p>`;
        return;
    }
    let totalCost = 0;
    let rowsHtml = currentAppState.cart.map((item, idx) => {
        totalCost += item.meal.price;
        return `<div class="cart-item-row">
            <span>${item.meal.name} (${item.plan})</span>
            <strong>₦${item.meal.price}</strong>
            <button class="remove-item-btn" onclick="removeFromCart(${idx})">✕</button>
        </div>`;
    }).join('');

    const paymentMethodMarkup = [
        { value: 'paystack', label: 'Paystack (cards)', note: 'Secure card payments' },
        { value: 'flutterwave', label: 'Flutterwave (cards)', note: 'Secure card payments' }
    ].map(option => `
        <label class="payment-option ${currentAppState.selectedPaymentMethod === option.value ? 'active' : ''}">
            <input type="radio" name="payment-method" value="${option.value}" ${currentAppState.selectedPaymentMethod === option.value ? 'checked' : ''} onchange="selectPaymentMethod('${option.value}')">
            <span>${option.label} • ${option.note}</span>
        </label>
    `).join('');

    const showManualVerify = !!currentAppState.paymentReference;

    container.innerHTML = `
        <div class="section-title">Checkout & Fulfillment Gateway</div>
        <div class="meal-container-card">${rowsHtml}</div>
        <div class="cart-item-row"><span>Total Payable:</span><strong>₦${totalCost}</strong></div>
        <div class="meal-container-card">
            <h4 style="margin:0 0 8px 0; color:var(--bheemz-green);">Payment methods</h4>
            <div class="payment-methods">${paymentMethodMarkup}</div>
        </div>
        <div class="delivery-form">
            <input type="text" id="del-address" value="${currentAppState.user ? currentAppState.user.address : ''}" placeholder="Confirm Address">
            <input type="date" id="del-date">
            <input type="time" id="del-time">
            <button onclick="requireAuthOrPrompt(() => processCheckout())" style="background:var(--bheemz-orange); color:white; padding:12px; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Complete Checkout</button>
            ${showManualVerify ? `<button onclick="manualVerifyPayment()" style="margin-top:10px; width:100%; padding:12px; border:none; border-radius:8px; background:var(--bheemz-green); color:white; font-weight:bold; cursor:pointer;">I've completed payment</button>` : ''}
        </div>
    `;
}

function selectPaymentMethod(method) {
    currentAppState.selectedPaymentMethod = method;
    saveSession();
    if (document.querySelector('.nav-control.active')?.textContent.includes('Cart')) {
        renderCartView(document.getElementById('main-content-view'));
    }
}

async function readJsonResponse(res) {
    const text = await res.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { error: text.slice(0, 200) };
    }
}

async function manualVerifyPayment() {
    if (!currentAppState.paymentReference) {
        showToast('No pending payment to verify.');
        return;
    }
    const endpoint = currentAppState.selectedPaymentMethod === 'flutterwave' ? 'flutterwave' : 'paystack';
    try {
        const verifyRes = await apiFetch(`${BACKEND_URL}/${endpoint}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: currentAppState.paymentReference })
        });
        const verifyData = await readJsonResponse(verifyRes);
        if (verifyRes.ok && verifyData.status === 'success') {
            completeCheckout();
        } else {
            showToast(verifyData.error || 'Payment not yet confirmed. Try again in a moment.');
        }
    } catch (error) {
        showToast(error.message || 'Could not verify payment.');
    }
}

async function startPaystackCheckout() {
    if (!currentAppState.user?.email) {
        showToast('Please log in before completing checkout.');
        return;
    }

    if (!currentAppState.cart.length) {
        showToast('Your cart is empty.');
        return;
    }

    const totalAmount = currentAppState.cart.reduce((sum, item) => sum + (Number(item.meal?.price) || 0), 0);
    if (!totalAmount) {
        showToast('Add a meal plan before checking out.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/paystack/initialize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentAppState.user.email,
                amount: Math.round(totalAmount * 100),
                metadata: {
                    cartItems: currentAppState.cart.map(item => ({
                        name: item.meal?.name,
                        plan: item.plan,
                        price: item.meal?.price
                    }))
                }
            })
        });
        const data = await readJsonResponse(res);
        if (!res.ok || !data.authorization_url) {
            showToast(data.error || 'Unable to start Paystack checkout.');
            return;
        }

        currentAppState.paymentReference = data.reference;
        saveSession();

        await openExternalUrl(data.authorization_url);
        showToast('Complete your payment, then return here and tap "I\'ve completed payment" in your cart.');
        renderCartView(document.getElementById('main-content-view'));

    } catch (error) {
        currentAppState.paymentReference = null;
        showToast(error.message || 'Paystack checkout could not be started. Please try again.');
    }
}

async function startFlutterwaveCheckout() {
    if (!currentAppState.user?.email) {
        showToast('Please log in before completing checkout.');
        return;
    }

    if (!currentAppState.cart.length) {
        showToast('Your cart is empty.');
        return;
    }

    const totalAmount = currentAppState.cart.reduce((sum, item) => sum + (Number(item.meal?.price) || 0), 0);
    if (!totalAmount) {
        showToast('Add a meal plan before checking out.');
        return;
    }

    try {
        const res = await apiFetch(`${BACKEND_URL}/flutterwave/initialize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentAppState.user.email,
                name: currentAppState.user.name || currentAppState.user.full_name || 'Guest',
                phone: currentAppState.user.phone || '',
                amount: Math.round(totalAmount),
                metadata: {
                    cartItems: currentAppState.cart.map(item => ({
                        name: item.meal?.name,
                        plan: item.plan,
                        price: item.meal?.price
                    }))
                }
            })
        });
        const data = await readJsonResponse(res);
        if (!res.ok || !data.authorization_url) {
            throw new Error(data.error || 'Unable to start Flutterwave checkout.');
        }

        currentAppState.paymentReference = data.reference;
        saveSession();

        await openExternalUrl(data.authorization_url);
        showToast('Complete your payment, then return here and tap "I\'ve completed payment" in your cart.');
        renderCartView(document.getElementById('main-content-view'));

    } catch (error) {
        currentAppState.paymentReference = null;
        showToast(error.message || 'Flutterwave checkout could not be started. Please try again.');
    }
}

function completeCheckout() {
    currentAppState.cart = [];
    currentAppState.paymentReference = null;
    document.getElementById('cart-counter').innerText = '0';
    saveSession();
    showToast('Payment completed. Your meal plan is confirmed.');
    switchView('menu');
}

async function processCheckout() {
    if (!currentAppState.user) {
        showAuthModal();
        return;
    }

    if (currentAppState.selectedPaymentMethod === 'paystack') {
        await startPaystackCheckout();
    }
    else if (currentAppState.selectedPaymentMethod === 'flutterwave') {
        await startFlutterwaveCheckout();
    }
}

function executePaymentGateway() {
    processCheckout();
}

function getMealOfTheDay(meals) {
    if (!meals || meals.length === 0) return null;
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return meals[dayOfYear % meals.length];
}

function requireAuthOrPrompt(actionCallback) {
    if (currentAppState.user) {
        actionCallback();
    } else {
        showAuthModal();
    }
}

async function renderTodayMealView(container) {
    container.innerHTML = '<p>Loading today\'s meal...</p>';
    const meals = await apiFetchMealsForProfile('All');
    currentAppState.currentMenu = meals;
    const meal = getMealOfTheDay(meals);

    if (!meal) {
        container.innerHTML = '<p>No meal available right now.</p>';
        return;
    }

    const idx = meals.indexOf(meal);
    container.innerHTML = `
        <div class="section-title"> Today's Meal</div>
        <div class="meal-container-card">
            <h3>${meal.name}</h3>
            <p> ${meal.portion} | ₦${meal.price}</p>
            <p style="color:var(--bheemz-green); font-size:12px;">✨ ${meal.benefits}</p>
            <div class="macro-grid">
                <div class="macro-item"><strong>${meal.calories}</strong>Cal</div>
                <div class="macro-item"><strong>${meal.protein}</strong>Prot</div>
                <div class="macro-item"><strong>${meal.carbs}</strong>Carb</div>
                <div class="macro-item"><strong>${meal.fats}</strong>Fat</div>
            </div>
        
        <div class="sub-selectors" style="margin-top:10px;">
                <select id="plan-type-${idx}">
                    <option value="Single Purchase">One-time Order</option>
                    <option value="Daily Plan">Daily Plan</option>
                    <option value="Weekly Plan">Weekly Plan (7 Days)</option>
                    <option value="Monthly Plan">Monthly Plan (30 Days)</option>
                </select>
            </div>

            <div class="action-row" style="margin-top:12px;">
                <button class="buy-btn" onclick="requireAuthOrPrompt(() => addToCartEngine(${idx}))">Add to Cart</button>
                <button class="recipe-btn" onclick="requireAuthOrPrompt(() => showRecipeModal(${idx}))">View Full Recipe</button>
            </div>
        </div>
    `;
}

async function renderExpertsView(container) {
    container.innerHTML = '<p>Loading experts...</p>';
    let experts = [];
    try {
        const res = await apiFetch(`${BACKEND_URL}/experts`);
        if (!res.ok) throw new Error(`Experts request failed (${res.status})`);
        experts = await res.json();
        if (!Array.isArray(experts)) throw new Error('Experts response was not a list');
    } catch {
        experts = [
            { id: 1, name: 'Dr. Amaka Obi', title: 'Registered Dietitian', specialty: 'Diabetes Management', bio: 'Helps clients manage blood sugar through sustainable Nigerian meal planning.' },
            { id: 2, name: 'Dr. Tunde Bakare', title: 'Clinical Nutritionist', specialty: 'Weight Management', bio: 'Specializes in culturally relevant weight loss and gain plans.' }
        ];
    }

    if (!experts.length) {
        container.innerHTML = '<p>No experts available right now.</p>';
        return;
    }

    currentAppState.currentExperts = experts;

    container.innerHTML = `
        <div class="section-title">Meet Our Experts</div>
        <p style="font-size:12px; color:var(--muted-grey); margin-top:-6px;">Connect with a licensed nutritionist or dietitian for personalized guidance.</p>
        ${experts.map((expert, idx) => `
            <div class="meal-container-card">
                <h4>${expert.name}</h4>
                <p style="color:var(--bheemz-green); font-size:12px; margin:2px 0;">${expert.title} • ${expert.specialty}</p>
                <p style="font-size:12px;">${expert.bio}</p>
                <button onclick="requireAuthOrPrompt(() => openConsultationRequest(${idx}))" style="width:100%; padding:10px; border:none; border-radius:8px; background:var(--bheemz-orange); color:white; font-weight:bold; cursor:pointer; margin-top:8px;">Request Consultation</button>
            </div>
        `).join('')}
    `;
}

function openConsultationRequest(idx) {
    const expert = currentAppState.currentExperts[idx];
    if (!expert) return;

    let overlay = document.getElementById('consultation-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'consultation-modal-overlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="auth-card">
            <h2>Request Consultation</h2>
            <p>With ${expert.name} — ${expert.specialty}</p>
            <textarea id="consultation-message" placeholder="What would you like help with?" style="width:100%; min-height:80px; margin:10px 0; padding:8px; border-radius:8px; border:1px solid #ccc;"></textarea>
            <button onclick="submitConsultationRequest(${expert.id})">Send Request</button>
            <div class="small-note"><span onclick="document.getElementById('consultation-modal-overlay').style.display='none';">Cancel</span></div>
        </div>
    `;
}

async function submitConsultationRequest(expertId) {
    const message = document.getElementById('consultation-message').value.trim();
    try {
        const res = await apiFetch(`${BACKEND_URL}/consultations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expert_id: expertId, message })
        });
        const data = await readJsonResponse(res);
        document.getElementById('consultation-modal-overlay').style.display = 'none';
        showToast(data.message || 'Request sent.');
    } catch (error) {
        document.getElementById('consultation-modal-overlay').style.display = 'none';
        showToast('Could not send request. Please try again.');
    }
}

async function renderDashboardView(container) {
    container.innerHTML = '<p>Loading your dashboard...</p>';
    const meals = await apiFetchMealsForProfile('All');
    currentAppState.currentMenu = meals;
    const mealOfDay = getMealOfTheDay(meals);

    const isGuest = !currentAppState.user;
    const name = isGuest ? 'Guest' : (currentAppState.user.name || currentAppState.user.full_name || 'there');
    const goal = currentAppState.healthProfile?.goal || 'Healthy Eating';

    container.innerHTML = `
        <div class="section-title">${isGuest ? 'Welcome 👋' : `Welcome back, ${name} 👋`}</div>
        ${isGuest ? `<div class="meal-container-card"><p>Browsing as a guest. <a href="#" onclick="showAuthModal(); return false;">Sign up</a> to save your profile and order meals.</p></div>` : ''}
        <div class="meal-container-card">
            <h4 style="margin:0 0 6px 0; color:var(--bheemz-green);">Your Goal</h4>
            <p>${goal}</p>
        </div>
        ${mealOfDay ? `
        <div class="meal-container-card">
            <h4 style="margin:0 0 6px 0; color:var(--bheemz-orange);"> Today's Meal</h4>
            <h3>${mealOfDay.name}</h3>
            <p> ${mealOfDay.portion} | ₦${mealOfDay.price}</p>
            <p style="color:var(--bheemz-green); font-size:12px;">✨ ${mealOfDay.benefits}</p>
            <button onclick="switchView('todaymeal')" style="margin-top:10px; width:100%; padding:10px; border:none; border-radius:8px; background:var(--bheemz-orange); color:white; font-weight:bold; cursor:pointer;">View Today's Meal</button>
        </div>` : ''}
        <div class="meal-container-card">
            <button onclick="showProfileModal()" style="width:100%; padding:12px; border:none; border-radius:8px; background:var(--bheemz-orange); color:white; font-weight:bold; cursor:pointer;">Set Up Your Health Profile</button>
        </div>
        <div class="meal-container-card">
            <button onclick="switchView('menu')" style="width:100%; padding:12px; border:none; border-radius:8px; background:var(--bheemz-green); color:white; font-weight:bold; cursor:pointer;">Browse Your Full Menu</button>
        </div>
        <div class="meal-container-card" style="position:relative; overflow:hidden;">
            <h4 style="margin:0 0 6px 0; color:var(--bheemz-orange);">🔒 Coming Soon (Premium)</h4>
            <ul style="opacity:0.6; filter:blur(0.3px); margin:0; padding-left:18px;">
                <li>🤖 AI-Powered Meal Recommendations</li>
                <li>🚚 Real-Time Delivery Tracking</li>
                <li>👨‍👩‍👧 Family Meal Planning</li>
                <li>🎁 Loyalty & Rewards Program</li>
                <li>📊 Advanced Health Analytics</li>
            </ul>
            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.05); backdrop-filter:blur(1px); display:flex; align-items:center; justify-content:center;">
                <span style="background:var(--bheemz-orange); color:white; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:bold;">🔒 Unlocking Soon</span>
            </div>
        </div>
    `;
}

function renderTrackerView(container) {
    const dailyTarget = currentAppState.healthProfile ? determineDailyTarget(currentAppState.healthProfile.goal) : 1800;
    const totalLogged = currentAppState.mealLog.reduce((sum, item) => sum + item.calories, 0);
    const progress = Math.min(100, Math.round((totalLogged / dailyTarget) * 100));
    const recentMeals = currentAppState.mealLog.slice(-5).reverse();

    container.innerHTML = `
        <div class="section-title">Nutrition & Progress Dashboard</div>
        <div class="meal-container-card">
            <h4>Calorie Intake Budget</h4>
            <p>Target Goal: ${dailyTarget} kcal / day</p>
            <p>Consumption Logged: ${totalLogged} kcal</p>
            <div style="background:#E2E8F0; border-radius:8px; height:12px; margin-top:10px; overflow:hidden;">
                <div style="background:var(--bheemz-green); width:${progress}%; height:100%;"></div>
            </div>
            <p style="font-size:11px; color:#64748B; margin-top:6px;">${progress}% of today's goal</p>
        </div>
        <div class="tip-card">
            <strong>Healthy cooking guide:</strong> Choose natural spices, reduce oil by using nonstick cooking methods, and skip artificial seasoning for cleaner meals.
        </div>
        <div class="meal-container-card">
            <h4>Recent Food Tracking</h4>
            ${recentMeals.length === 0 ? '<p>No meals logged yet. Tap "Log Meal" on a menu item to begin tracking real-life intake.</p>' : `<ul class="tracker-list">${recentMeals.map(meal => `<li><strong>${meal.name}</strong> • ${meal.calories} kcal • ${meal.loggedAt}</li>`).join('')}</ul>`}
        </div>
    `;
}

function determineDailyTarget(goal) {
    const expectedCalories = Number(currentAppState.healthProfile?.expectedCalories || 0);
    if (expectedCalories > 0) return expectedCalories;
    if (goal === 'Weight Loss') return 1600;
    if (goal === 'Weight Gain') return 2400;
    if (goal === 'Fitness Maintenance') return 2000;
    return 1800;
}

function showRecipeModal(idx) {
    const meal = currentAppState.currentMenu[idx];
    if (!meal) return;
    document.getElementById('recipe-title').innerText = meal.name;
    document.getElementById('recipe-duration').innerText = meal.recipeDetails?.duration || 'Approx. 15 minutes';
    document.getElementById('recipe-text').innerText = meal.recipeSummary || meal.recipe || 'This meal uses low oil, natural spices, and no artificial seasoning for a healthier taste experience.';

    const ingredientList = document.getElementById('recipe-ingredients');
    const stepList = document.getElementById('recipe-steps');
    ingredientList.innerHTML = '';
    stepList.innerHTML = '';

    const ingredients = meal.recipeDetails?.ingredients || [];
    const steps = meal.recipeDetails?.steps || [];

    if (ingredients.length) {
        ingredients.forEach(item => {
            const li = document.createElement('li');
            li.innerText = item;
            ingredientList.appendChild(li);
        });
    } else {
        ingredientList.innerHTML = '<li>No ingredient details available.</li>';
    }

    if (steps.length) {
        steps.forEach(step => {
            const li = document.createElement('li');
            li.innerText = step;
            stepList.appendChild(li);
        });
    } else {
        stepList.innerHTML = '<li>No cooking steps available.</li>';
    }

    document.getElementById('recipe-notes').innerText = meal.recipeDetails?.notes || '';
    document.getElementById('recipe-modal').style.display = 'flex';
}

function closeRecipeModal() {
    document.getElementById('recipe-modal').style.display = 'none';
}

function toggleNotificationPreference(key, enabled) {
    currentAppState.notificationPreferences[key] = enabled;
    saveSession();
}

function saveNotificationPreferences() {
    saveSession();
    showToast('Notification preferences saved.');
}

function renderFeaturesView(container) {
    const prefs = currentAppState.notificationPreferences;
    container.innerHTML = `
        <div class="section-title">Business & Customer Experience Suite</div>
        <div class="feature-grid">
            <div class="feature-card">
                <h4>Payment Features</h4>
                <ul>
                    <li>Secure online payments</li>
                    <li>Card payments</li>
                    <li>Bank transfer</li>
                    <li>USSD payments</li>
                </ul>
            </div>
            <div class="feature-card">
                <h4>Notification Types</h4>
                <div class="preference-list">
                    <label><input type="checkbox" ${prefs.mealReminders ? 'checked' : ''} onchange="toggleNotificationPreference('mealReminders', this.checked)"> Meal reminders</label>
                    <label><input type="checkbox" ${prefs.deliveryUpdates ? 'checked' : ''} onchange="toggleNotificationPreference('deliveryUpdates', this.checked)"> Delivery updates</label>
                    <label><input type="checkbox" ${prefs.renewalReminders ? 'checked' : ''} onchange="toggleNotificationPreference('renewalReminders', this.checked)"> Subscription renewal reminders</label>
                    <label><input type="checkbox" ${prefs.healthyTips ? 'checked' : ''} onchange="toggleNotificationPreference('healthyTips', this.checked)"> Healthy eating tips</label>
                </div>
                <button onclick="saveNotificationPreferences()" style="margin-top:10px; width:100%; padding:10px; border:none; border-radius:8px; background:var(--bheemz-green); color:white; font-weight:bold; cursor:pointer;">Save Preferences</button>
            </div>
            <div class="feature-card">
                <h4>Channels</h4>
                <ul>
                    <li>Push notifications</li>
                    <li>SMS</li>
                    <li>Email</li>
                </ul>
            </div>
            <div class="feature-card">
                <h4>Admin Dashboard</h4>
                <div class="admin-grid">
                    <div class="admin-stat"><strong>Upload meals</strong>Manage new meal plans and calorie details.</div>
                    <div class="admin-stat"><strong>Edit calorie info</strong>Update nutrition data for each meal.</div>
                    <div class="admin-stat"><strong>Manage subscriptions</strong>Track daily, weekly and monthly plans.</div>
                    <div class="admin-stat"><strong>Track deliveries</strong>Monitor orders and fulfillment status.</div>
                    <div class="admin-stat"><strong>View payments</strong>Review completed and pending payments.</div>
                    <div class="admin-stat"><strong>View health preferences</strong>Review customer goals and allergies.</div>
                </div>
            </div>
            <div class="feature-card">
                <h4>User Flow</h4>
                <ul>
                    <li>Step 1: User downloads the app.</li>
                    <li>Step 2: User creates an account.</li>
                    <li>Step 3: User enters delivery address and health goals.</li>
                    <li>Step 4: User browses healthy meals with calorie information.</li>
                    <li>Step 5: User selects a one-time meal or subscription plan.</li>
                    <li>Step 6: User chooses delivery date and time.</li>
                    <li>Step 7: User makes payment.</li>
                    <li>Step 8: Meal is prepared and delivered.</li>
                </ul>
            </div>
            <div class="feature-card">
                <h4>Platforms</h4>
                <ul>
                    <li>Android</li>
                    <li>iOS</li>
                </ul>
            </div>
        </div>
    `;
}

function switchView(view) {
    document.querySelectorAll('.nav-control').forEach(el => el.classList.toggle('active', el.textContent.includes(capitalize(view))));
    const container = document.getElementById('main-content-view');

    if (view === 'experts') {
    renderExpertsView(container);
} else if (view === 'todaymeal') {
        renderTodayMealView(container);
    } else if (view === 'dashboard') {
        renderDashboardView(container);
    } else if (view === 'menu') {
        container.innerHTML = '<div class="section-title">Tailored Dietary Recommendations</div><div id="menu-target-container"></div>';
        loadMenuPayload();
    } else if (view === 'cart') {
        renderCartView(container);
    } else if (view === 'tracker') {
        renderTrackerView(container);
    } else if (view === 'features') {
        renderFeaturesView(container);
    }
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}