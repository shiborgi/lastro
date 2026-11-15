-- sales: invariants a CHECK cannot express.
--
-- Appended to the generated init after finance's (ADR 11).

-- Product categories nest one level, like financial categories: a category
-- with a group may not itself be a group, and a group may not move inside one.
CREATE OR REPLACE FUNCTION product_category_depth() RETURNS trigger AS $$
DECLARE
  parent_parent integer;
  children integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id INTO parent_parent
    FROM product_categories
   WHERE book_id = NEW.book_id AND id = NEW.parent_id;

  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION
      'product categories nest one level: the chosen group is already inside a group'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO children
    FROM product_categories WHERE book_id = NEW.book_id AND parent_id = NEW.id;
  IF children > 0 THEN
    RAISE EXCEPTION
      'that product category is a group; it cannot move inside another group'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_category_depth_trigger ON product_categories;
--> statement-breakpoint
CREATE TRIGGER product_category_depth_trigger
  BEFORE INSERT OR UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION product_category_depth();
--> statement-breakpoint
-- Sales evidence (ADR 21): a link joins a movement to the line that says
-- what it printed, on its day, in its currency, under the movement's key.
CREATE OR REPLACE FUNCTION sale_movement_link_matches() RETURNS trigger AS $$
DECLARE
  movement_row sale_movements%ROWTYPE;
  line_row sales%ROWTYPE;
BEGIN
  SELECT * INTO movement_row FROM sale_movements
   WHERE book_id = NEW.book_id AND id = NEW.movement_id;
  SELECT * INTO line_row FROM sales
   WHERE book_id = NEW.book_id AND id = NEW.sale_id;
  IF movement_row.id IS NULL OR line_row.id IS NULL THEN
    RETURN NEW; -- the foreign keys reject this row on their own
  END IF;
  IF NEW.external_key <> movement_row.external_id
     OR NEW.sale_key <> movement_row.external_id || '-sale' THEN
    RAISE EXCEPTION 'a sale link carries its movement''s external key and <external key>-sale'
      USING ERRCODE = '23514';
  END IF;
  IF movement_row.business_date <> line_row.business_date
     OR movement_row.quantity <> line_row.quantity
     OR movement_row.revenue <> line_row.revenue
     OR movement_row.currency <> line_row.currency THEN
    RAISE EXCEPTION 'a sale line says what its movement printed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sale_movement_links_match
  BEFORE INSERT OR UPDATE ON sale_movement_links
  FOR EACH ROW EXECUTE FUNCTION sale_movement_link_matches();
--> statement-breakpoint
-- A sale movement is POSTED exactly when it has its link. At commit: posting
-- writes the link and the status in either order.
CREATE OR REPLACE FUNCTION sale_movement_posted_link() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
  book integer := (row_data ->> 'book_id')::integer;
  movement integer := (row_data ->> CASE WHEN TG_TABLE_NAME = 'sale_movements' THEN 'id' ELSE 'movement_id' END)::integer;
  movement_status text;
  link_count integer;
BEGIN
  SELECT status INTO movement_status FROM sale_movements WHERE book_id = book AND id = movement;
  IF movement_status IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO link_count FROM sale_movement_links WHERE book_id = book AND movement_id = movement;
  IF (movement_status = 'POSTED') <> (link_count = 1) THEN
    RAISE EXCEPTION 'sale movement % is % and has % links', movement, movement_status, link_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_movements_posted_link
  AFTER INSERT OR UPDATE ON sale_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_movement_posted_link();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_movement_links_posted_link
  AFTER INSERT OR UPDATE OR DELETE ON sale_movement_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_movement_posted_link();
--> statement-breakpoint
-- A sale line exists only as what a movement became: one without its link
-- is refused at commit.
CREATE OR REPLACE FUNCTION sale_line_has_link() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE book_id = NEW.book_id AND id = NEW.id)
     AND NOT EXISTS (
       SELECT 1 FROM sale_movement_links WHERE book_id = NEW.book_id AND sale_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'sale line % is linked to no movement', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_have_link
  AFTER INSERT OR UPDATE ON sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_line_has_link();
