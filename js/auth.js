/**
 * DrugAssist - Autentikáció és Munkamenet Kezelő Modul
 * Fájl: js/auth.js
 */

const Auth = {
    // Jelenleg bejelentkezett felhasználó lekérése
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

    // Munkamenet-védelem az oldalakra (ha nincs belépve, visszadobja az index.html-re)
    requireAuth() {
        const user = this.getCurrentUser();
        if (!user) {
            window.location.href = 'index.html';
            return null;
        }
        return user;
    },

    // Bejelentkezési logika
    async login(username, password) {
        if (!username || !password) {
            return { success: false, message: "Kérjük, adja meg a felhasználónevet és a jelszót!" };
        }

        try {
            // 1. Próbálkozás Supabase-en keresztül (ha fel vannak véve a profilok)
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('username', username)
                    .single();

                if (data && !error) {
                    const userData = {
                        id: data.id,
                        username: data.username,
                        name: data.full_name,
                        role: data.default_role || 'pharmacist',
                        department: data.default_department || 'Belgyógyászat'
                    };
                    localStorage.setItem('drugassist_user', JSON.stringify(userData));
                    return { success: true, user: userData };
                }
            }

            // 2. Fallback / Demó bejelentkezés (amíg az adatok feltöltése folyik)
            const demoUser = {
                id: "demo-user-001",
                username: username,
                name: username === 'gergo' ? 'Dr. Tarszabó Gergely' : 'Dr. Kovács Anna',
                role: 'pharmacist',
                department: 'Belgyógyászat'
            };
            
            localStorage.setItem('drugassist_user', JSON.stringify(demoUser));
            return { success: true, user: demoUser };

        } catch (err) {
            console.error("Bejelentkezési hiba:", err);
            return { success: false, message: "Hiba történt a bejelentkezés során!" };
        }
    },

    // Kijelentkezési logika
    async logout() {
        localStorage.removeItem('drugassist_user');
        if (window.supabaseClient && window.supabaseClient.auth) {
            await window.supabaseClient.auth.signOut();
        }
        window.location.href = 'index.html';
    },

    // Aktív szerepkör vagy osztály váltása a munkamenetben
    updateSessionContext(role, department) {
        const user = this.getCurrentUser();
        if (user) {
            if (role) user.role = role;
            if (department) user.department = department;
            localStorage.setItem('drugassist_user', JSON.stringify(user));
        }
    }
};

// Automatikus eseménykezelő a bejelentkezési gombra, ha az index.html-en vagyunk
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.querySelector('button[onclick*="dashboard.html"]');
    if (loginBtn) {
        // Átírjuk a gomb viselkedését, hogy a valódi login logikát futtassa
        loginBtn.removeAttribute('onclick');
        loginBtn.addEventListener('click', async () => {
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value.trim() : '';

            const result = await Auth.login(username, password);
            if (result.success) {
                window.location.href = 'dashboard.html';
            } else {
                alert(result.message);
            }
        });
    }
});
