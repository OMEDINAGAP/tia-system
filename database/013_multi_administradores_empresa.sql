-- Permite que una empresa tenga varios administradores autorizados.
-- Ejecutar una sola vez sobre una base existente.

ALTER TABLE cuentas_empresa
  ADD KEY idx_cuentas_empresa_empresa (empresa_id);

ALTER TABLE cuentas_empresa
  DROP INDEX uq_cuentas_empresa_empresa,
  ADD COLUMN nombre VARCHAR(120) NULL AFTER empresa_id;

UPDATE cuentas_empresa
SET nombre = usuario
WHERE nombre IS NULL OR nombre = '';

ALTER TABLE sesiones_empresa
  ADD COLUMN cuenta_empresa_id BIGINT UNSIGNED NULL AFTER empresa_id,
  ADD KEY idx_sesiones_empresa_cuenta (cuenta_empresa_id),
  ADD CONSTRAINT fk_sesiones_empresa_cuenta
    FOREIGN KEY (cuenta_empresa_id) REFERENCES cuentas_empresa(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Las sesiones anteriores no estaban asociadas a una cuenta individual.
-- Se cierran para que cada administrador vuelva a iniciar sesion con su propia cuenta.
DELETE FROM sesiones_empresa WHERE proposito = 'GESTIONAR_PERSONAS';
