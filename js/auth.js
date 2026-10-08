/**
 * DrugAssist - Egyszerűsített Belső Hitelesítés
 * Fájl: js/auth.js
 */

const Auth = {
    // Jelenleg bejelentkezett felhasználó lekérése LocalStorage-ból
    getCurrentUser() {
        const userStr = localStorage.getItem('drugassist_user');
        if (!userStr) return null;
        try {
            return JSON.parse(userStr);
        } catch (e) {
            console.error("Érvénytelen munkamenet adatok:", e);
            return null;
        }
    },

    // Munkamenet-védelem az oldalakhoz
    requireAuth() {
        const user = this.getCurrentUser();
        if (!user) {
            window.location.href = 'index.html';
            return null;
        }
        return user;
    },

    // Bejelentkezés a profiles tábla alapján
    async login(username, password) {
        if (!username || !password) {
            return { success: false, message: "Kérjük, adja meg a felhasználónevet és a jelszót!" };
        }

        try {
            if (!window.supabaseClient) {
                return { success: false, message: "Hiba: A Supabase kapcsolat nem érhető el!" };
            }

            // 1. Felhasználó és jelszó pontos lekérdezése a profiles táblából
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('id, username, full_name, password, default_department, default_role')
                .eq('username', username)
                .single();

            if (error || !profile) {
                return { success: false, message: "Hibás felhasználónév vagy jelszó!" };
            }

            // 2. Jelszó egyezőség ellenőrzése
            if (profile.password !== password) {
                return { success: false, message: "Hibás felhasználónév vagy jelszó!" };
            }

            // 3. Szerepkörök lekérése a user_roles táblából
            const { data: rolesData } = await window.supabaseClient
                .from('user_roles')
                .select('role')
                .eq('user_id', profile.id);

            const userRoles = (rolesData && rolesData.length > 0) 
                ? rolesData.map(r => r.role) 
                : [profile.default_role];

            // 4. Munkamenet elmentése
            const userData = {
                id: profile.id,
                username: profile.username,
                name: profile.full_name,
                activeRole: profile.default_role || userRoles[0],
                roles: userRoles,
                activeDepartment: profile.default_department || 'Belgyógyászat'
            };

            localStorage.setItem('drugassist_user', JSON.stringify(userData));
            return { success: true, user: userData };

        } catch (err) {
            console.error("Bejelentkezési hiba:", err);
            return { success: false, message: "Rendszerhiba történt a bejelentkezés során!" };
        }
    },

    // Kijelentkezés
    logout() {
        localStorage.removeItem('drugassist_user');
        window.location.href = 'index.html';
    },

    // Munkamenet kontextus frissítése (szerepkör / osztály)
    updateContext(newRole, newDepartment) {
        const user = this.getCurrentUser();
        if (user) {
            if (newRole) user.activeRole = newRole;
            if (newDepartment) user.activeDepartment = newDepartment;
            localStorage.setItem('drugassist_user', JSON.stringify(user));
        }
    }
};

// Automatikus eseménykezelő az index.html-en lévő gombra
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginButton');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value.trim() : '';

            const errorBox = document.getElementById('loginError');
            if (errorBox) errorBox.innerText = '';

            const result = await Auth.login(username, password);
            if (result.success) {
                window.location.href = 'dashboard.html';
            } else {
                if (errorBox) {
                    errorBox.innerText = result.message;
                } else {
                    alert(result.message);
                }
            }
        });
    }
});
