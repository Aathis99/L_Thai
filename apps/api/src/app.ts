import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import {
  all,
  one,
  transaction,
  PERMISSIONS,
  audit as log,
  type Db,
} from "./database.js";
import { handlePressingRoute } from "./pressing/routes.js";
import {
  ApiError,
  fail,
  text,
  username,
  hashPassword,
  verifyPassword,
  digest,
  DUMMY_HASH,
} from "./auth.js";

type Options = {
  origins?: string[];
  secureCookies?: boolean;
  internalHosts?: string[];
};
const permissions = (row: any): string[] => JSON.parse(row.permissions);
const flag = (value: unknown) =>
  typeof value === "boolean"
    ? Number(value)
    : fail("สถานะต้องเป็นเปิดหรือปิดใช้งาน");
function identifier(value: unknown, label: string) {
  const result = text(value, label, false, 30).replace(/[\s-]/g, "");
  if (result && !/^[0-9]{13}$/.test(result))
    fail(`${label}ต้องเป็นตัวเลข 13 หลัก หรือเว้นว่าง`);
  return result;
}
export function createApplication(pool: pg.Pool, options: Options = {}) {
  const origins = new Set(
    options.origins || ["http://127.0.0.1:3000", "http://localhost:3000"],
  );
  const hosts = new Set([
    "127.0.0.1",
    "localhost",
    ...(options.internalHosts || []),
    ...[...origins].map((origin) => new URL(origin).hostname),
  ]);
  const attempts = new Map<string, { n: number; until: number }>();
  const app = express();
  app.disable("x-powered-by");
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: options.secureCookies || false,
  };
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    try {
      if (!hosts.has(new URL("http://" + req.get("host")).hostname))
        fail("Host ไม่ได้รับอนุญาต", 403);
      if (!["GET", "HEAD"].includes(req.method)) {
        if (req.get("origin") && !origins.has(req.get("origin")!))
          fail("ไม่อนุญาตคำขอจากเว็บไซต์อื่น", 403);
        if (req.method !== "DELETE" && !req.is("application/json"))
          fail("ต้องส่งข้อมูล JSON", 415);
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json({ limit: "32kb", strict: true }));
  async function foreign(
    db: Db,
    table: "roles" | "positions" | "employees",
    value: unknown,
    label: string,
    optional = false,
  ): Promise<number | null> {
    if (optional && (value === null || value === "" || value === undefined))
      return null;
    if (!Number.isSafeInteger(value)) return fail(`ไม่พบ${label}ที่เลือก`);
    const item = await one(db, `SELECT * FROM ${table} WHERE id=$1`, [value]);
    if (!item) return fail(`ไม่พบ${label}ที่เลือก`);
    if (table === "employees" && item.archived)
      fail("ไม่สามารถเชื่อมบัญชีกับพนักงานที่ลบแล้ว");
    return value as number;
  }
  async function actor(db: Db, token: string | undefined) {
    if (!token) return null;
    const user = await one(
      db,
      `SELECT u.id,u.username,u.name,u.role_id,u.employee_id,r.name AS role_name,r.permissions FROM sessions s
      JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
      WHERE s.token_hash=$1 AND s.expires>$2 AND u.active=1 AND u.deleted=0`,
      [digest(token), Date.now()],
    );
    return user ? { ...user, permissions: permissions(user) } : null;
  }
  async function protectLastAdmin(
    db: Db,
    existing: any,
    role: number,
    active: number,
  ) {
    if (existing.role_id === 1 && existing.active && (!active || role !== 1)) {
      if (
        Number(
          (
            await one(
              db,
              "SELECT count(*) AS n FROM users WHERE role_id=1 AND active=1 AND deleted=0",
            )
          ).n,
        ) <= 1
      )
        fail("ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน", 409);
    }
  }
  app.use("/api", async (req, res) => {
    const path = req.path,
      method = req.method;
    const body: Record<string, any> = req.body === undefined ? {} : req.body;
    if (!body || Array.isArray(body) || typeof body !== "object")
      fail("ข้อมูลต้องเป็น JSON object");
    const setupRequired = async (db: Db) =>
      !(await one(db, "SELECT id FROM users LIMIT 1"));
    if (path === "/health" && method === "GET") {
      await pool.query("SELECT 1");
      return void res.json({ ok: true, database: "postgresql" });
    }
    if (path === "/setup" && method === "GET")
      return void res.json({ required: await setupRequired(pool) });
    if (path === "/setup" && method === "POST") {
      if (!(await setupRequired(pool))) fail("ตั้งผู้ดูแลระบบแล้ว", 409);
      const login = username(body.username),
        name = text(body.name, "ชื่อผู้ดูแล"),
        hash = await hashPassword(body.password);
      const id = await transaction(pool, async (db) => {
        if (!(await setupRequired(db))) fail("ตั้งผู้ดูแลระบบแล้ว", 409);
        const result = await one(
          db,
          "INSERT INTO users(username,name,password_hash,role_id) VALUES($1,$2,$3,1) RETURNING id",
          [login, name, hash],
        );
        await log(db, login, "ตั้งผู้ดูแลระบบ", login);
        return result.id;
      });
      return void res.status(201).json({ id });
    }
    if (path === "/login" && method === "POST") {
      const login =
        typeof body.username === "string"
          ? body.username.trim().toLowerCase()
          : "";
      const key = (req.socket.remoteAddress || "") + ":" + login;
      let bucket = attempts.get(key);
      if (!bucket || bucket.until < Date.now()) {
        if (attempts.size > 10000)
          for (const [k, b] of attempts)
            if (b.until < Date.now()) attempts.delete(k);
        bucket = { n: 0, until: Date.now() + 900000 };
        attempts.set(key, bucket);
      }
      if (bucket.n >= 10) fail("ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที", 429);
      bucket.n++;
      const user = await one(
        pool,
        "SELECT * FROM users WHERE lower(username)=$1 AND deleted=0",
        [login],
      );
      const valid = await verifyPassword(
        body.password,
        user?.password_hash || DUMMY_HASH,
      );
      const token = randomBytes(32).toString("hex");
      await transaction(pool, async (db) => {
        const current =
          user && (await one(db, "SELECT * FROM users WHERE id=$1", [user.id]));
        if (
          !valid ||
          !current?.active ||
          current.deleted ||
          current.password_hash !== user.password_hash
        )
          fail("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401);
        await db.query("DELETE FROM sessions WHERE expires<$1", [Date.now()]);
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,expires) VALUES($1,$2,$3)",
          [digest(token), user.id, Date.now() + 28800000],
        );
      });
      attempts.delete(key);
      res.cookie("session", token, { ...cookieOptions, maxAge: 28800000 });
      return void res.json({ ok: true });
    }
    const token = (req.get("cookie") || "").match(
      /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const user = await actor(pool, token);
    if (!user) fail("กรุณาเข้าสู่ระบบใหม่", 401);
    const requirePermission = (permission: string, granted = user.permissions) => {
      if (!granted.includes(permission))
        fail("คุณไม่มีสิทธิ์ทำรายการนี้", 403);
    };
    if (
      path.startsWith("/pressing/") &&
      (await handlePressingRoute(req, res, {
        db: pool,
        require: requirePermission,
        async mutate(permission, run) {
          requirePermission("pressing.read");
          requirePermission(permission);
          return transaction(pool, async (db) => {
            const currentActor = await actor(db, token);
            if (!currentActor) fail("กรุณาเข้าสู่ระบบใหม่", 401);
            requirePermission("pressing.read", currentActor.permissions);
            requirePermission(permission, currentActor.permissions);
            return run(db, currentActor);
          });
        },
      }))
    ) return;
    if (path === "/me" && method === "GET")
      return void res.json({ user, permissions: PERMISSIONS });
    if (path === "/logout" && method === "POST") {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(token!),
      ]);
      res.clearCookie("session", cookieOptions);
      return void res.json({ ok: true });
    }
    if (path === "/password" && method === "POST") {
      const previous = (
        await one(pool, "SELECT password_hash FROM users WHERE id=$1", [
          user.id,
        ])
      ).password_hash;
      if (!(await verifyPassword(body.current, previous)))
        fail("รหัสผ่านเดิมไม่ถูกต้อง");
      const hash = await hashPassword(body.password);
      await transaction(pool, async (db) => {
        const current = await one(
          db,
          "SELECT password_hash FROM users WHERE id=$1",
          [user.id],
        );
        if (!(await actor(db, token)) || current.password_hash !== previous)
          fail("ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่", 409);
        await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          hash,
          user.id,
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
        await log(db, user.username, "เปลี่ยนรหัสผ่าน", user.username);
      });
      res.clearCookie("session", cookieOptions);
      return void res.json({ ok: true });
    }
    const route = path.match(
      /^\/(employees|positions|users|roles|audit)(?:\/([1-9]\d*))?$/,
    );
    if (!route) fail("ไม่พบรายการ", 404);
    const [, resource, rawId] = route,
      id = rawId ? Number(rawId) : null;
    if (id && !Number.isSafeInteger(id)) fail("รหัสรายการไม่ถูกต้อง");
    const needed =
      resource === "employees"
        ? `employees.${method === "GET" ? "read" : method === "POST" ? "create" : method === "PUT" ? "update" : "delete"}`
        : resource === "audit"
          ? "audit.read"
          : resource + ".manage";
    if (
      resource === "positions" &&
      method === "GET" &&
      user.permissions.includes("employees.read")
    ) {
    } else if (
      resource === "roles" &&
      method === "GET" &&
      user.permissions.includes("users.manage")
    ) {
    } else requirePermission(needed);
    if (method === "GET" && !id) {
      const queries: Record<string, string> = {
        employees:
          "SELECT e.*,p.name AS position_name FROM employees e LEFT JOIN positions p ON p.id=e.position_id ORDER BY e.archived,e.id DESC",
        positions: "SELECT * FROM positions ORDER BY name",
        roles: "SELECT * FROM roles ORDER BY id",
        users:
          "SELECT u.id,u.username,u.name,u.role_id,u.employee_id,u.active,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE deleted=0 ORDER BY u.id",
        audit: "SELECT * FROM audit ORDER BY id DESC LIMIT 300",
      };
      let items = await all(pool, queries[resource]);
      if (resource === "roles")
        items = items.map((r) => ({ ...r, permissions: permissions(r) }));
      return void res.json({ items });
    }
    if (
      resource === "audit" ||
      !["POST", "PUT", "DELETE"].includes(method) ||
      (method === "POST" && id) ||
      (method !== "POST" && !id)
    )
      fail("ไม่รองรับรายการนี้", 405);
    // Slow hashing happens outside the transaction. Every reference and permission is checked again under the lock.
    let newHash: string | undefined;
    if (
      resource === "users" &&
      method !== "DELETE" &&
      (method === "POST" || body.password)
    )
      newHash = await hashPassword(body.password);
    const saved = await transaction(pool, async (db) => {
      const currentActor = await actor(db, token);
      if (!currentActor) fail("กรุณาเข้าสู่ระบบใหม่", 401);
      if (!currentActor.permissions.includes(needed))
        fail("คุณไม่มีสิทธิ์ทำรายการนี้", 403);
      const existing = id
        ? await one(db, `SELECT * FROM ${resource} WHERE id=$1`, [id])
        : null;
      if (id && (!existing || existing.deleted || existing.archived))
        fail("ไม่พบรายการหรือรายการถูกลบแล้ว", 404);
      let row: any;
      if (method === "DELETE") {
        if (resource === "employees") {
          const linkedAdmin = await one(
            db,
            "SELECT * FROM users WHERE employee_id=$1 AND role_id=1 AND active=1 AND deleted=0",
            [id],
          );
          if (linkedAdmin) await protectLastAdmin(db, linkedAdmin, 1, 0);
          await db.query(
            "UPDATE employees SET active=0,archived=1,updated_at=now() WHERE id=$1",
            [id],
          );
          await db.query(
            "DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE employee_id=$1)",
            [id],
          );
          await db.query("UPDATE users SET active=0 WHERE employee_id=$1", [
            id,
          ]);
        }
        if (resource === "users") {
          await protectLastAdmin(db, existing, existing.role_id, 0);
          await db.query(
            "UPDATE users SET active=0,deleted=1,employee_id=NULL WHERE id=$1",
            [id],
          );
          await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
        }
        if (resource === "positions") {
          if (
            await one(
              db,
              "SELECT id FROM employees WHERE position_id=$1 LIMIT 1",
              [id],
            )
          )
            fail(
              "ตำแหน่งนี้มีพนักงานอ้างอิงอยู่ กรุณาเปลี่ยนตำแหน่งพนักงานก่อน",
              409,
            );
          await db.query("DELETE FROM positions WHERE id=$1", [id]);
        }
        if (resource === "roles") {
          if (
            id === 1 ||
            (await one(db, "SELECT id FROM users WHERE role_id=$1 LIMIT 1", [
              id,
            ]))
          )
            fail("ไม่สามารถลบบทบาทสงวนหรือบทบาทที่มีบัญชีอ้างอิงอยู่", 409);
          await db.query("DELETE FROM roles WHERE id=$1", [id]);
        }
      } else if (resource === "employees") {
        const values = [
          text(body.code, "รหัสพนักงาน", true, 40),
          text(body.name, "ชื่อพนักงาน"),
          text(body.department, "แผนก", false, 80),
          await foreign(db, "positions", body.position_id, "ตำแหน่ง", true),
          text(body.phone, "เบอร์โทร", false, 30),
          flag(body.active ?? true),
        ];
        values.push(
          identifier(
            body.social_security_number ?? existing?.social_security_number,
            "เลขประกันสังคม",
          ),
          identifier(
            body.taxpayer_id ?? existing?.taxpayer_id,
            "เลขประจำตัวประชาชนผู้เสียภาษีอากร",
          ),
        );
        row =
          method === "POST"
            ? await one(
                db,
                "INSERT INTO employees(code,name,department,position_id,phone,active,social_security_number,taxpayer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
                values,
              )
            : await one(
                db,
                "UPDATE employees SET code=$1,name=$2,department=$3,position_id=$4,phone=$5,active=$6,social_security_number=$7,taxpayer_id=$8,updated_at=now() WHERE id=$9 RETURNING id",
                [...values, id],
              );
      } else if (resource === "positions") {
        const name = text(body.name, "ชื่อตำแหน่ง", true, 80);
        row =
          method === "POST"
            ? await one(
                db,
                "INSERT INTO positions(name) VALUES($1) RETURNING id",
                [name],
              )
            : await one(
                db,
                "UPDATE positions SET name=$1 WHERE id=$2 RETURNING id",
                [name, id],
              );
      } else if (resource === "roles") {
        if (id === 1) fail("บทบาทผู้ดูแลระบบเป็นบทบาทสงวน", 409);
        if (
          !Array.isArray(body.permissions) ||
          body.permissions.some(
            (p: unknown) =>
              typeof p !== "string" || !Object.hasOwn(PERMISSIONS, p),
          )
        )
          fail("รายการสิทธิ์ไม่ถูกต้อง");
        const values = [
          text(body.name, "ชื่อบทบาท", true, 80),
          JSON.stringify([...new Set(body.permissions)]),
        ];
        row =
          method === "POST"
            ? await one(
                db,
                "INSERT INTO roles(name,permissions) VALUES($1,$2) RETURNING id",
                values,
              )
            : await one(
                db,
                "UPDATE roles SET name=$1,permissions=$2 WHERE id=$3 RETURNING id",
                [...values, id],
              );
      } else if (resource === "users") {
        const login = username(body.username),
          name = text(body.name, "ชื่อผู้ใช้งาน"),
          role = (await foreign(db, "roles", body.role_id, "บทบาท")) as number;
        const employee = await foreign(
            db,
            "employees",
            body.employee_id,
            "พนักงาน",
            true,
          ),
          active = flag(body.active ?? true);
        if (existing) await protectLastAdmin(db, existing, role, active);
        if (method === "POST")
          row = await one(
            db,
            "INSERT INTO users(username,name,role_id,employee_id,active,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [login, name, role, employee, active, newHash],
          );
        else {
          row = await one(
            db,
            "UPDATE users SET username=$1,name=$2,role_id=$3,employee_id=$4,active=$5 WHERE id=$6 RETURNING id",
            [login, name, role, employee, active, id],
          );
          if (newHash)
            await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
              newHash,
              id,
            ]);
          if (newHash || !active)
            await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
        }
      }
      const savedId = id || row.id;
      await log(
        db,
        currentActor.username,
        (
          { POST: "เพิ่ม", PUT: "แก้ไข", DELETE: "ลบ" } as Record<
            string,
            string
          >
        )[method] +
          " " +
          (
            {
              employees: "พนักงาน",
              positions: "ตำแหน่ง",
              users: "บัญชี",
              roles: "บทบาท",
            } as Record<string, string>
          )[resource],
        String(savedId),
      );
      return savedId;
    });
    return void res
      .status(method === "POST" ? 201 : 200)
      .json({ id: saved, ok: true });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "ไม่พบรายการ" });
  });
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError)
      return void res.status(error.status).json({ error: error.message });
    if (error.type === "entity.parse.failed")
      return void res
        .status(400)
        .json({ error: "รูปแบบข้อมูล JSON ไม่ถูกต้อง" });
    if (error.type === "entity.too.large")
      return void res.status(413).json({ error: "ข้อมูลมีขนาดใหญ่เกินไป" });
    if (error.code === "23505")
      return void res
        .status(409)
        .json({
          error:
            "รหัส ชื่อ หรือข้อมูลเชื่อมโยงนี้มีอยู่แล้ว กรุณาตรวจสอบรายการซ้ำ",
        });
    if (error.code === "23503")
      return void res
        .status(409)
        .json({
          error:
            "ข้อมูลถูกใช้งานอยู่หรือข้อมูลอ้างอิงเปลี่ยนแปลง กรุณาโหลดใหม่",
        });
    console.error("API error:", error.code || error.name);
    res.status(500).json({ error: "ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่" });
  });
  return { app, server: createServer(app) };
}
