const token = sessionStorage.getItem("token");



if (!token || !token.startsWith("admin-")) {
    window.location.href = "/admin-login.html";
}


function updateTime() {
    document.getElementById("time").innerText =
        new Date().toLocaleTimeString();
}
setInterval(updateTime, 1000);

/* async function loadDashboard() {

    const token = sessionStorage.getItem("token");

    if (!token) {
        window.location.href = "/";
        return;
    }

    const res = await fetch("/admin-data", {
        headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) {
        window.location.href = "/";
        return;
    }

    const data = await res.json();

    // 🔥 NORMALIZAR DATOS
    allUsers = data.users.map(u => ({
        ...u,
        progress: parseFloat(u.progress) || 0
    }));

    filteredUsers = [...allUsers];
    currentPage = 1;

    // 🔥 CONTADORES CORRECTOS
    let done = 0;
    let progress = 0;
    let fail = 0;

    let completedV1 = 0;
    let completedV2 = 0;

    data.users.forEach(u => {

        const total =
            (Number(u.video1) + Number(u.video2)) / 2;

        // 🔥 KPIs
        if (total >= 95) {
            done++;
        }
        else if (total < 30) {
            fail++;
        }
        else {
            progress++;
        }

        // 🔥 VIDEOS COMPLETADOS
        if (Number(u.video1) >= 95) {
            completedV1++;
        }

        if (Number(u.video2) >= 95) {
            completedV2++;
        }

    });

    // 🔥 KPIs
    document.getElementById("users").innerText = allUsers.length;
    document.getElementById("done").innerText = done;
    document.getElementById("progress").innerText = progressCount;
    document.getElementById("fail").innerText = fail;

    // 🔥 BARRA GLOBAL
    const avg = allUsers.reduce((a, b) => a + b.progress, 0) / allUsers.length || 0;
    document.getElementById("bar-fill").style.width = avg + "%";
    document.getElementById("bar-text").innerText = avg.toFixed(1) + "%";

    // 🔥 ALERTAS
    const alerts = document.getElementById("alerts");
    alerts.innerHTML = "";
    allUsers.forEach(u => {
        if (u.progress < 10) {
            alerts.innerHTML += `<li>⚠ ${u.name} no avanza</li>`;
        }
    });

    // 🔥 ACTIVIDAD
    const activity = document.getElementById("activity");
    activity.innerHTML = "";
    data.activity.forEach(a => {
        activity.innerHTML += `<li>${a}</li>`;
    });

    // 🔥 TABLA
    renderTable();

    // 🔥 CHART
    const ctx = document.getElementById("chart");

    if (chart) chart.destroy();

    chart = new Chart(ctx, {

        type: 'doughnut',

        data: {

            labels: [
                'Completados',
                'En curso',
                'Bajo',
                'TIA completo',
                'Seguridad completo'
            ],

            datasets: [{

                data: [
                    done,
                    progress,
                    fail,
                    completedV1,
                    completedV2
                ],

                backgroundColor: [
                    '#22c55e',
                    '#eab308',
                    '#ef4444',
                    '#3b82f6',
                    '#8b5cf6'
                ]

            }]
        }

    });
}
 */

async function loadDashboard() {

    const token = sessionStorage.getItem("token");

    if (!token) {
        window.location.href = "/";
        return;
    }

    const res = await fetch("/admin-data", {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    if (!res.ok) {
        window.location.href = "/";
        return;
    }

    const data = await res.json();

    // 🔥 NORMALIZAR
    allUsers = data.users.map(u => {

        const video1 = Number(u.video1) || 0;
        const video2 = Number(u.video2) || 0;

        const total = (video1 + video2) / 2;

        return {
            ...u,
            video1,
            video2,
            total
        };
    });

    filteredUsers = [...allUsers];
    currentPage = 1;

    // 🔥 KPIs
    let done = 0;
    let progressCount = 0;
    let fail = 0;

    let completedV1 = 0;
    let completedV2 = 0;

    allUsers.forEach(u => {

        // ✅ STATUS GENERAL
        if (u.total >= 95) {
            done++;
        }
        else if (u.total < 30) {
            fail++;
        }
        else {
            progressCount++;
        }

        // ✅ VIDEO 1 COMPLETADO
        if (u.video1 >= 95) {
            completedV1++;
        }

        // ✅ VIDEO 2 COMPLETADO
        if (u.video2 >= 95) {
            completedV2++;
        }

    });

    // 🔥 CARDS KPI
    document.getElementById("users").innerText =
        allUsers.length;

    document.getElementById("done").innerText =
        done;

    document.getElementById("progress").innerText =
        progressCount;

    document.getElementById("fail").innerText =
        fail;

    // 🔥 PROGRESO GLOBAL REAL
    const avg =
        allUsers.reduce((acc, u) => acc + u.total, 0)
        / allUsers.length || 0;

    document.getElementById("bar-fill").style.width =
        avg + "%";

    document.getElementById("bar-text").innerText =
        avg.toFixed(1) + "%";

    // 🔥 ALERTAS
    const alerts = document.getElementById("alerts");

    alerts.innerHTML = "";

    allUsers.forEach(u => {

        if (u.total < 30) {

            alerts.innerHTML += `
                <li>⚠ ${u.name} no avanza</li>
            `;
        }

    });

    // 🔥 ACTIVIDAD
    const activity =
        document.getElementById("activity");

    activity.innerHTML = "";

    data.activity.forEach(a => {

        activity.innerHTML += `
            <li>${a}</li>
        `;

    });

    // 🔥 TABLA
    renderTable();

    // 🔥 CHART
    const ctx =
        document.getElementById("chart");

    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {

        type: "doughnut",

        data: {

            labels: [
                "Completados",
                "En curso",
                "Bajo",
                "TIA completo",
                "Seguridad completo"
            ],

            datasets: [{

                data: [
                    done,
                    progressCount,
                    fail,
                    completedV1,
                    completedV2
                ],

                backgroundColor: [
                    "#22c55e",
                    "#eab308",
                    "#ef4444",
                    "#3b82f6",
                    "#8b5cf6"
                ],

                borderWidth: 3,
                borderColor: "#1e293b"

            }]
        },

        options: {

            responsive: true,

            plugins: {

                legend: {
                    labels: {
                        color: "#fff",
                        font: {
                            size: 14
                        }
                    }
                }

            }

        }

    });

}


function logout() {
    sessionStorage.removeItem("token"); // 🔥 destruye sesión
    window.location.href = "/"; // regresar al login
}

function copyCode() {
    const code = document.getElementById("dailyCode").innerText;
    navigator.clipboard.writeText(code);
    alert("Código copiado");
}

async function loadDailyCode() {

    const res = await fetch("/daily-code", {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    const data = await res.json();

    document.getElementById("dailyCode").innerText = data.code;
}


loadDashboard();
loadDailyCode();
setInterval(loadDashboard, 5000);


let allUsers = [];
let filteredUsers = [];

let currentPage = 1;
const perPage = 20;
let chart;

function renderTable() {

    const start = (currentPage - 1) * perPage;
    const end = start + perPage;

    const usersToShow = filteredUsers.slice(start, end);

    const table = document.getElementById("table");
    table.innerHTML = "";

    usersToShow.forEach(u => {
        const total =
            (Number(u.video1) + Number(u.video2)) / 2;
        let badge = "warn";

        if (total >= 92) {
            badge = "ok";
        }
        else if (total < 30) {
            badge = "bad";
        }

        table.innerHTML += `
        <tr>
            <td>${u.name}</td>
            <td>
  <div class="mini-progress">
    <div class="mini-fill green"
      style="width:${u.video1}%"></div>
  </div>
  ${Number(u.video1).toFixed(0)}%
</td>

<td>
  <div class="mini-progress">
    <div class="mini-fill blue"
      style="width:${u.video2}%"></div>
  </div>
  ${Number(u.video2).toFixed(0)}%
</td>
            <td><span class="badge ${badge}">
                ${badge === "ok" ? "Completado" : badge === "warn" ? "En curso" : "Bajo"}
            </span></td>
        </tr>
        `;
    });

    document.getElementById("pageInfo").innerText =
        `Página ${currentPage} de ${Math.ceil(filteredUsers.length / perPage)}`;
}

function filterUsers() {

    const term = document.getElementById("searchInput").value.toLowerCase();

    filteredUsers = allUsers.filter(u =>
        u.name.toLowerCase().includes(term)
    );

    currentPage = 1;
    renderTable();
}



function nextPage() {
    if (currentPage < Math.ceil(filteredUsers.length / perPage)) {
        currentPage++;
        renderTable();
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}