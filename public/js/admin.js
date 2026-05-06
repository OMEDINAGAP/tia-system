const token = sessionStorage.getItem("token");



if (!token || !token.startsWith("admin-")) {
    window.location.href = "/admin-login.html";
}


function updateTime() {
    document.getElementById("time").innerText =
        new Date().toLocaleTimeString();
}
setInterval(updateTime, 1000);

async function loadDashboard() {

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
    let done = 0, progressCount = 0, fail = 0;

    allUsers.forEach(u => {
        if (u.progress >= 100) done++;
        else if (u.progress < 10) fail++;
        else progressCount++;
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
            labels: ['Completado', 'En curso', 'Bajo'],
            datasets: [{
                data: [done, progressCount, fail],
                backgroundColor: ['#22c55e', '#eab308', '#ef4444']
            }]
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

        let badge = "warn";

        if (u.progress >= 100) badge = "ok";
        else if (u.progress < 10) badge = "bad";

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