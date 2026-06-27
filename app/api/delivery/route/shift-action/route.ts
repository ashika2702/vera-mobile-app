import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "../../../../../lib/db";
import { getStartOfDayIST, formatDateToISO } from "../../../../../lib/timezone";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

// Helper to authenticate JWT
function authenticate(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return decoded;
  } catch (error) {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user || !user.deliveryBoyId) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { deliveryBoyId } = user;
    const { action, latitude, longitude } = await req.json();

    if (!['START', 'PAUSE', 'RESUME', 'END'].includes(action)) {
      return NextResponse.json({ success: false, message: "Invalid action" }, { status: 400 });
    }

    const now = new Date();
    const todayIST = getStartOfDayIST(now);
    const dateStr = formatDateToISO(todayIST);

    return await withTransaction(async (client) => {
      // 1. Find the Route
      const routeRes = await client.query(
        `SELECT "id", "isSubmitted", "shiftStatus" FROM "Route" WHERE "deliveryBoyId" = $1 AND "date"::date = $2::date FOR UPDATE`,
        [deliveryBoyId, dateStr]
      );

      if (routeRes.rows.length === 0) {
        return NextResponse.json({ success: false, message: "Route not found for today" }, { status: 404 });
      }

      const route = routeRes.rows[0];

      if (route.isSubmitted) {
        return NextResponse.json({ success: false, message: "Route has already been submitted and is locked." }, { status: 400 });
      }

      const currentStatus = route.shiftStatus;

      // Validate transitions
      let nextStatus = currentStatus;
      if (action === 'START') {
        if (currentStatus !== 'NOT_STARTED') return NextResponse.json({ success: false, message: "Shift already started" }, { status: 400 });
        nextStatus = 'IN_PROGRESS';
      } else if (action === 'PAUSE') {
        if (currentStatus !== 'IN_PROGRESS') return NextResponse.json({ success: false, message: "Shift is not in progress" }, { status: 400 });
        nextStatus = 'PAUSED';
      } else if (action === 'RESUME') {
        if (currentStatus !== 'PAUSED') return NextResponse.json({ success: false, message: "Shift is not paused" }, { status: 400 });
        nextStatus = 'IN_PROGRESS';
      } else if (action === 'END') {
        if (currentStatus !== 'IN_PROGRESS' && currentStatus !== 'PAUSED') return NextResponse.json({ success: false, message: "Cannot end shift from current status" }, { status: 400 });
        
        // Check for pending orders before ending
        const pendingOrdersRes = await client.query(
          `SELECT COUNT(*)::int as count 
           FROM "RouteOrder" ro
           INNER JOIN "Order" o ON ro."orderId" = o."id"
           WHERE ro."routeId" = $1
             AND ro."deliveryStatus" = 'PENDING'
             AND o."status" != 'CANCELLED'
             AND NOT (o."paymentMethod" = 'ONLINE' AND o."paymentStatus" = 'PENDING')`,
          [route.id]
        );

        if (pendingOrdersRes.rows[0].count > 0) {
           return NextResponse.json({ success: false, message: `Cannot end shift. There are still ${pendingOrdersRes.rows[0].count} pending orders.` }, { status: 400 });
        }
        
        nextStatus = 'COMPLETED';
      }

      // 2. Update Route Status
      await client.query(
        `UPDATE "Route" SET "shiftStatus" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        [nextStatus, route.id]
      );

      // 3. Create Audit Log
      await client.query(
        `INSERT INTO "RouteShiftLog" ("id", "routeId", "action", "triggeredBy", "timestamp")
         VALUES (gen_random_uuid(), $1, $2::"ShiftActionType", $3, NOW())`,
        [route.id, action, `staff_${deliveryBoyId}`]
      );

      // If action is END, also mark route as submitted
      if (action === 'END') {
          await client.query(
            `UPDATE "Route" SET "isSubmitted" = true, "submittedAt" = NOW() WHERE "id" = $1`,
            [route.id]
          );
      }

      return NextResponse.json({ success: true, message: `Shift ${action} successful`, shiftStatus: nextStatus });
    });
  } catch (error: any) {
    console.error("Error in POST /api/delivery/route/shift-action:", error);
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}
