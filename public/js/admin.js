const token = sessionStorage.getItem("token");



if (!token || !token.startsWith("admin-")) {
    window.location.href = "/admin-login.html";
}


function updateTime() {
    document.getElementById("time").innerText =
        new Date().toLocaleTimeString();
}
setInterval(updateTime, 1000);

let chart;

async function loadDashboard() {
    const token = sessionStorage.getItem("token");
    let allUsers = [];
    let filteredUsers = [];
    let currentPage = 1;
    const perPage = 20;

    if (!token) {
        window.location.href = "/";
    }

    const res = await fetch("/admin-data", {
        headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) {
        // 🔥 si no autorizado → regresar
        window.location.href = "/";
        return;
    }


    const data = await res.json();

    let done = 0, progress = 0, fail = 0;

    allUsers = data.users;
    filteredUsers = [...allUsers];


    const table = document.getElementById("table");
    table.innerHTML = "";

    data.users.forEach(u => {

        let badge = "warn";

        if (u.progress >= 100) { done++; badge = "ok"; }
        else if (u.progress < 10) { fail++; badge = "bad"; }
        else progress++;

        table.innerHTML += `
      <tr>
        <td>${u.name}</td>
        <td>${u.progress.toFixed(1)}%</td>
        <td><span class="badge ${badge}">
          ${badge === "ok" ? "Completado" : badge === "warn" ? "En curso" : "Bajo"}
        </span></td>
      </tr>
    `;
    });

    document.getElementById("users").innerText = data.users.length;
    document.getElementById("done").innerText = done;
    document.getElementById("progress").innerText = progress;
    document.getElementById("fail").innerText = fail;

    const avg = data.users.reduce((a, b) => a + b.progress, 0) / data.users.length || 0;
    document.getElementById("bar-fill").style.width = avg + "%";
    document.getElementById("bar-text").innerText = avg.toFixed(1) + "%";

    // ALERTAS
    const alerts = document.getElementById("alerts");
    alerts.innerHTML = "";
    data.users.forEach(u => {
        if (u.progress < 10) {
            alerts.innerHTML += `<li>⚠ ${u.name} no avanza</li>`;
        }
    });

    // ACTIVIDAD
    const activity = document.getElementById("activity");
    activity.innerHTML = "";
    data.activity.forEach(a => {
        activity.innerHTML += `<li>${a}</li>`;
    });

    // CHART
    const ctx = document.getElementById("chart");

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completado', 'En curso', 'Bajo'],
            datasets: [{
                data: [done, progress, fail],
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

function renderTable() {

    const start = (currentPage - 1) * perPage;
    const end = start + perPage;

    const usersToShow = filteredUsers.slice(start, end);

    const tbody = document.getElementById("usersBody");
    tbody.innerHTML = "";

    usersToShow.forEach(u => {

        let statusClass = "low";

        if (u.progress >= 80) statusClass = "ok";
        else if (u.progress >= 40) statusClass = "mid";

        tbody.innerHTML += `
      <tr>
        <td>${u.name}</td>
        <td>${u.progress.toFixed(1)}%</td>
        <td><span class="badge ${statusClass}">
          ${statusClass === "ok" ? "Alto" : statusClass === "mid" ? "Medio" : "Bajo"}
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