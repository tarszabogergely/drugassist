/**
 * DrugAssist - Intelligens PuPha Kereső Modul
 * Fájl: js/pupha-search.js
 */

const PuphaSearch = {
    timer: null,

    // Gépelés figyelése késleltetéssel (debounce - 300ms)
    onInput(searchTerm, callback) {
        clearTimeout(this.timer);
        
        if (!searchTerm || searchTerm.trim().length < 3) {
            callback([]);
            return;
        }

        this.timer = setTimeout(async () => {
            const results = await this.search(searchTerm.trim());
            callback(results);
        }, 300);
    },

    // Supabase kereső lekérdezés (Név, Hatóanyag, ATC kód)
    async search(term) {
        if (!window.supabaseClient) return [];

        try {
            const { data, error } = await window.supabaseClient
                .from('pupha_master')
                .select('id, ttt_code, brand_name, active_ingredient, atc_code, package_size')
                .or(`brand_name.ilike.%${term}%,active_ingredient.ilike.%${term}%,atc_code.ilike.%${term}%`)
                .limit(15);

            if (error) {
                console.error("PuPha keresési hiba:", error);
                return [];
            }

            return data || [];
        } catch (err) {
            console.error("Rendszerhiba a keresés során:", err);
            return [];
        }
    }
};
