/**
 * DrugAssist - Orvos / Ápoló Gyógyszerigénylő Modul
 * Fájl: js/prescription.js
 */

const Prescription = {
    currentPatientId: null,
    currentPrescriptionId: null,
    items: [],

    // 1. Beteg adatainak és meglévő/tegnapi igénylésének betöltése
    async loadPatientOrder(patientId) {
        this.currentPatientId = patientId;
        this.items = [];

        try {
            // Beteg adatai
            const { data: patient } = await window.supabaseClient
                .from('patients')
                .select('*')
                .eq('id', patientId)
                .single();

            if (patient) {
                document.getElementById('patientName').innerText = patient.name;
                document.getElementById('patientInfo').innerText = `TAJ: ${patient.taj} | Ágy: ${patient.room_bed}`;
            }

            // Mai aktív igénylés keresése
            const todayStr = new Date().toISOString().split('T')[0];
            const { data: todayPrescription } = await window.supabaseClient
                .from('prescriptions')
                .select('*, prescription_items(*, pupha_master(*))')
                .eq('patient_id', patientId)
                .gte('created_at', todayStr)
                .single();

            if (todayPrescription) {
                this.currentPrescriptionId = todayPrescription.id;
                this.items = todayPrescription.prescription_items.map(item => ({
                    id: item.id,
                    pupha_id: item.pupha_drug_id,
                    name: item.pupha_master ? item.pupha_master.brand_name : 'Ismeretlen gyógyszer',
                    atc: item.pupha_master ? item.pupha_master.atc_code : '',
                    morning: item.dose_morning || 0,
                    noon: item.dose_noon || 0,
                    evening: item.dose_evening || 0,
                    night: item.dose_night || 0,
                    isOwn: item.is_own_medication || false,
                    originalOrder: item.original_order_text || ''
                }));
            }
            
            this.renderTable();

        } catch (err) {
            console.error("Hiba a beteg igénylésének betöltésekor:", err);
        }
    },

    // 2. Tegnapi patika által jóváhagyott terápia másolása (SQL tárolt eljárás hívása)
    async copyPreviousDay() {
        const user = Auth.getCurrentUser();
        if (!user || !this.currentPatientId) return;

        const todayStr = new Date().toISOString().split('T')[0];

        try {
            const { data: newPrescriptionId, error } = await window.supabaseClient.rpc('copy_previous_approved_prescription', {
                p_patient_id: this.currentPatientId,
                p_target_date: todayStr,
                p_user_id: user.id
            });

            if (error) {
                alert("Nincs korábbi jóváhagyott gyógyszerelés, amit át lehetne másolni.");
                return;
            }

            alert("Előző napi jóváhagyott terápia sikeresen betöltve!");
            await this.loadPatientOrder(this.currentPatientId);

        } catch (err) {
            console.error("Hiba a másolás során:", err);
        }
    },

    // 3. Intelligens PuPha Kereső (3 karakter felett)
    async searchPupha(searchTerm) {
        const dropdown = document.getElementById('puphaSearchResults');
        if (!searchTerm || searchTerm.length < 3) {
            dropdown.style.display = 'none';
            return;
        }

        try {
            const { data: results, error } = await window.supabaseClient
                .from('pupha_master')
                .select('id, brand_name, active_ingredient, atc_code, package_size')
                .or(`brand_name.ilike.%${searchTerm}%,active_ingredient.ilike.%${searchTerm}%,atc_code.ilike.%${searchTerm}%`)
                .limit(10);

            if (error || !results || results.length === 0) {
                dropdown.innerHTML = '<div class="dropdown-item empty">Nincs találat</div>';
                dropdown.style.display = 'block';
                return;
            }

            let html = '';
            results.forEach(drug => {
                html += `
                    <div class="dropdown-item" onclick="Prescription.addDrugFromPupha('${drug.id}', '${drug.brand_name.replace(/'/g, "\\'")}', '${drug.atc_code}')">
                        <strong>${drug.brand_name}</strong>
                        <div class="sub-text">Hatóanyag: ${drug.active_ingredient || '-'} | ATC: ${drug.atc_code} | ${drug.package_size || ''}</div>
                    </div>
                `;
            });

            dropdown.innerHTML = html;
            dropdown.style.display = 'block';

        } catch (err) {
            console.error("Keresési hiba:", err);
        }
    },

    // 4. Gyógyszer hozzáadása a helyi táblázathoz
    addDrugFromPupha(id, name, atc) {
        document.getElementById('puphaSearchInput').value = '';
        document.getElementById('puphaSearchResults').style.display = 'none';

        this.items.push({
            pupha_id: id,
            name: name,
            atc: atc,
            morning: 1,
            noon: 0,
            evening: 1,
            night: 0,
            isOwn: false,
            originalOrder: `${name} (1-0-1-0)` // Alapértelmezett elrendelt szöveg rögzítése
        });

        this.renderTable();
    },

    // 5. Adagolás vagy státusz módosítása a táblázatban
    updateItem(index, field, value) {
        if (field === 'isOwn') {
            this.items[index].isOwn = value;
        } else {
            this.items[index][field] = parseFloat(value) || 0;
        }
    },

    // Tétel törlése
    removeItem(index) {
        this.items.splice(index, 1);
        this.renderTable();
    },

    // 6. Táblázat kirajzolása (Auditing / Eredeti elrendelt utasítás megjelenítésével)
    renderTable() {
        const tbody = document.getElementById('prescriptionTableBody');
        if (!tbody) return;

        if (this.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nincs rögzített gyógyszer. Használja a fenti keresőt!</td></tr>';
            return;
        }

        let html = '';
        this.items.forEach((item, idx) => {
            html += `
                <tr>
                    <td>
                        <strong class="drug-title">${item.name}</strong>
                        <div class="atc-badge">ATC: ${item.atc}</div>
                        ${item.originalOrder ? `<div class="original-order-sub">📋 Eredetileg elrendelve: ${item.originalOrder}</div>` : ''}
                    </td>
                    <td><input type="number" step="0.5" min="0" value="${item.morning}" onchange="Prescription.updateItem(${idx}, 'morning', this.value)"></td>
                    <td><input type="number" step="0.5" min="0" value="${item.noon}" onchange="Prescription.updateItem(${idx}, 'noon', this.value)"></td>
                    <td><input type="number" step="0.5" min="0" value="${item.evening}" onchange="Prescription.updateItem(${idx}, 'evening', this.value)"></td>
                    <td><input type="number" step="0.5" min="0" value="${item.night}" onchange="Prescription.updateItem(${idx}, 'night', this.value)"></td>
                    <td style="text-align:center;">
                        <input type="checkbox" ${item.isOwn ? 'checked' : ''} onchange="Prescription.updateItem(${idx}, 'isOwn', this.checked)">
                    </td>
                    <td style="text-align:center;">
                        <button class="remove-btn" onclick="Prescription.removeItem(${idx})">🗑</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    // 7. Igénylés mentése és feladása a Patikának (Supabase)
    async submitOrder() {
        const user = Auth.getCurrentUser();
        if (!user) return;

        if (this.items.length === 0) {
            alert("Kérjük, legalább egy gyógyszert adjon hozzá az igényléshez!");
            return;
        }

        try {
            const todayStr = new Date().toISOString().replace(/-/g, '').slice(0, 8);
            const barcode = `DA-${todayStr}-${this.currentPatientId.substring(0, 4)}`;

            // Fejléc mentése / frissítése
            const { data: prescription, error: pError } = await window.supabaseClient
                .from('prescriptions')
                .upsert({
                    id: this.currentPrescriptionId || undefined,
                    patient_id: this.currentPatientId,
                    barcode: barcode,
                    status: 'submitted',
                    prescribed_by: user.id
                })
                .select()
                .single();

            if (pError) throw pError;

            // Régi tételek törlése és újak beszúrása
            if (this.currentPrescriptionId) {
                await window.supabaseClient.from('prescription_items').delete().eq('prescription_id', prescription.id);
            }

            const itemsToInsert = this.items.map(item => ({
                prescription_id: prescription.id,
                pupha_drug_id: item.pupha_id,
                dose_morning: item.morning,
                dose_noon: item.noon,
                dose_evening: item.evening,
                dose_night: item.night,
                is_own_medication: item.isOwn,
                original_order_text: item.originalOrder || `${item.name} (${item.morning}-${item.noon}-${item.evening}-${item.night})`
            }));

            await window.supabaseClient.from('prescription_items').insert(itemsToInsert);

            alert("Gyógyszerigénylés sikeresen feladva a Patikának!");
            window.location.href = 'ward.html';

        } catch (err) {
            console.error("Hiba a feladás során:", err);
            alert("Rendszerhiba történt a feladás közben!");
        }
    }
};
