CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`direction` text NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`payment` integer NOT NULL,
	`bank_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bank_id`) REFERENCES `accounting_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_movement_direction" CHECK("inventory_movements"."direction" in ('in', 'out')),
	CONSTRAINT "inventory_movement_positive_quantity" CHECK("inventory_movements"."quantity" > 0),
	CONSTRAINT "inventory_movement_positive_payment" CHECK("inventory_movements"."payment" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_token_unique` ON `inventory_movements` (`token`);
--> statement-breakpoint
CREATE TRIGGER inventory_movement_post AFTER INSERT ON inventory_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM accounting_accounts WHERE id = NEW.bank_id AND kind = 'bank'
  ) THEN RAISE(ABORT, 'INVENTORY_BANK_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_products WHERE id = NEW.product_id
  ) THEN RAISE(ABORT, 'INVENTORY_PRODUCT_MISSING') END;

  UPDATE inventory_products
  SET quantity = quantity + CASE WHEN NEW.direction = 'in' THEN NEW.quantity ELSE -NEW.quantity END
  WHERE id = NEW.product_id
    AND (NEW.direction = 'in' OR quantity >= NEW.quantity)
    AND (NEW.direction = 'out' OR quantity <= 999999999 - NEW.quantity);
  SELECT CASE WHEN changes() = 0 AND NEW.direction = 'out'
    THEN RAISE(ABORT, 'INVENTORY_INSUFFICIENT_STOCK') END;
  SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'INVENTORY_STOCK_LIMIT') END;

  INSERT INTO accounting_entries (
    token, transaction_date, recorded_at, recorded_by, notes, amount, debit_account_id, credit_account_id
  )
  SELECT 'inventory:' || NEW.token, date(NEW.recorded_at, '+7 hours'), NEW.recorded_at, NEW.recorded_by,
    (CASE WHEN NEW.direction = 'in' THEN 'Barang Masuk / 入库' ELSE 'Barang Keluar / 出库' END)
      || ' · ' || p.name || ' (#' || p.id || ') × ' || NEW.quantity,
    NEW.payment,
    CASE WHEN NEW.direction = 'in' THEN 'purchase-expenses' ELSE NEW.bank_id END,
    CASE WHEN NEW.direction = 'in' THEN NEW.bank_id ELSE 'other-income' END
  FROM inventory_products p WHERE p.id = NEW.product_id;
END;
