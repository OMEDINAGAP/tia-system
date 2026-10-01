# Guía de migración a hosting de pago — Sistema TIA

## Propósito

Esta guía define los controles mínimos para mover Sistema TIA a un hosting de pago sin perder información, trazabilidad, documentos ni capacidad de recuperación ante incidentes.

No copiar contraseñas, tokens, secretos SMTP o claves de cifrado en este archivo, repositorios Git, correos o chats.

## 1. Preparación antes de migrar

1. Crear un respaldo completo de la base de datos actual.
2. Conservar los archivos de `uploads/` y verificar que incluyan fotografías y documentos necesarios.
3. Registrar fecha, responsable, tamaño y hash SHA-256 del respaldo.
4. Probar la restauración en un entorno de prueba antes de modificar producción.
5. Mantener Railway activo hasta que el nuevo host sea validado funcionalmente.
6. Configurar un dominio HTTPS definitivo y actualizar `PUBLIC_URL` con ese dominio.

## 2. Variables de SharePoint para respaldos cifrados

Estas variables deben configurarse como secretos del hosting. Nunca deben estar en código fuente ni archivos públicos.

| Variable | Uso | Requisito |
| --- | --- | --- |
| `SHAREPOINT_TENANT_ID` | Identificador del tenant de Microsoft 365. | Valor de Microsoft Entra ID. |
| `SHAREPOINT_CLIENT_ID` | Identificador de la aplicación institucional registrada en Entra ID. | No reutilizar una aplicación personal. |
| `SHAREPOINT_CLIENT_SECRET` | Secreto de cliente de la aplicación institucional. | Guardar únicamente en secretos del hosting; rotar antes de caducar. |
| `SHAREPOINT_DRIVE_ID` | Identificador de la biblioteca documental de SharePoint destino. | Debe apuntar al sitio autorizado para respaldos. |
| `SHAREPOINT_BACKUP_FOLDER` | Carpeta dentro de la biblioteca donde se almacenarán los respaldos. | Ejemplo: `Respaldos-TIA`. |
| `BACKUP_ENCRYPTION_KEY` | Clave Base64 de 32 bytes para cifrado AES-256-GCM. | Generar una clave exclusiva para TIA y conservarla en un gestor de secretos institucional. |

El sistema no debe generar respaldos si falta cualquiera de estas variables.

## 3. Configuración recomendada en Microsoft 365 / SharePoint

1. Crear un sitio o biblioteca exclusiva, por ejemplo: `Seguridad TIAS / Respaldos-TIA`.
2. Registrar una aplicación en Microsoft Entra ID para el sistema TIA.
3. Asignar permiso de aplicación `Sites.Selected`; evitar permisos globales como acceso a todos los sitios.
4. Autorizar a la aplicación con permiso de escritura únicamente en el sitio de respaldos.
5. Generar un secreto de cliente con fecha de vencimiento controlada.
6. Registrar al responsable institucional, fecha de expiración y procedimiento de rotación.
7. Obtener el `DRIVE_ID` de la biblioteca autorizada y configurar las variables en el hosting.

## 4. Variables operativas adicionales del hosting

Configurar también las variables existentes del sistema, sin publicar sus valores:

- `NODE_ENV=production`
- `PORT`
- `PUBLIC_URL`
- `MYSQLHOST`, `MYSQLPORT`, `MYSQLDATABASE`, `MYSQLUSER`, `MYSQLPASSWORD`
- `SECRET`
- `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`

Usar un usuario de base de datos exclusivo para TIA y limitar sus permisos a la base de datos del sistema.

## 5. Secuencia de migración

1. Preparar el nuevo hosting, base de datos y dominio HTTPS.
2. Cargar variables de entorno como secretos del proveedor.
3. Desplegar el código desde el repositorio oficial de GitHub.
4. Restaurar la base de datos y los archivos requeridos.
5. Ejecutar el sistema y validar `/health`.
6. Ingresar con una cuenta administrativa autorizada.
7. Revisar el módulo **Seguridad operativa**.
8. Confirmar que aparece `SharePoint configurado`.
9. Generar un respaldo cifrado de prueba desde el módulo.
10. Confirmar en SharePoint que el archivo `.tiaenc` llegó a la carpeta establecida.
11. Confirmar que el respaldo muestra estado `VERIFICADO`, hash SHA-256 y fecha en Sistema TIA.
12. Validar inicio de sesión, curso, examen, carga de fotografía, documentos, constancia y auditoría.
13. Actualizar DNS solo después de completar todas las pruebas.

## 6. Prueba de restauración

La migración no queda concluida hasta probar una restauración en un entorno aislado.

La prueba debe comprobar:

- Que el archivo cifrado puede descifrarse usando `BACKUP_ENCRYPTION_KEY`.
- Que la estructura y datos de la base se restauran sin errores.
- Que fotografías, firmas, cartas, exámenes, constancias y auditoría siguen disponibles.
- Que el hash del archivo coincide con el registrado por el sistema.
- Que el entorno restaurado no envía correos reales ni modifica producción.

Registrar evidencia: fecha, responsable, archivo probado, hash, resultado y observaciones.

## 7. Reversión

Si una validación falla antes de cambiar DNS:

1. No desactivar Railway.
2. Corregir la configuración en el nuevo hosting.
3. Repetir la validación y la restauración de prueba.

Si falla después de cambiar DNS:

1. Restaurar temporalmente el DNS al servicio anterior.
2. Conservar bitácoras y evidencia del incidente.
3. Revocar cualquier secreto que pudiera haberse expuesto.
4. Corregir y repetir la migración de forma controlada.

## 8. Responsables mínimos

| Actividad | Responsable sugerido |
| --- | --- |
| Aprobación de migración | Dirección / Seguridad Aeroportuaria |
| Infraestructura, dominio y hosting | TI institucional |
| Base de datos y restauración | Administrador de base de datos / TI |
| SharePoint y aplicación Entra ID | Administrador Microsoft 365 |
| Validación funcional TIA | Personal autorizado del módulo TIA |
| Evidencia y cierre | Auditoría / Responsable del sistema |

## Lista de cierre

- [ ] El sitio usa HTTPS y el dominio oficial.
- [ ] Las variables están cargadas como secretos, no en archivos.
- [ ] Se validó acceso administrativo y roles.
- [ ] Se validó un flujo completo de colaborador.
- [ ] Se validó auditoría y seguridad operativa.
- [ ] Se generó un respaldo cifrado en SharePoint.
- [ ] Se probó una restauración aislada.
- [ ] Se documentaron responsables, fecha y evidencia de cierre.
