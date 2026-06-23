import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json();

    if (!identifier || !password) {
      return NextResponse.json(
        { success: false, message: "Username/Email and password are required" },
        { status: 400 }
      );
    }

    // Find the Admin user by email or username
    const admin = await prisma.admin.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier }
        ],
        active: true
      },
      include: {
        role: true,
        deliveryBoyProfiles: true // Fetch linked profiles
      }
    });

    if (!admin) {
      return NextResponse.json(
        { success: false, message: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, message: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Check role to ensure they are delivery staff
    if (admin.role?.name !== "Delivery Staff") {
      return NextResponse.json(
        { success: false, message: "Access denied. Only Delivery Staff can log in here." },
        { status: 403 }
      );
    }

    // Ensure they have a linked DeliveryBoy profile
    if (!admin.deliveryBoyProfiles || admin.deliveryBoyProfiles.length === 0) {
      return NextResponse.json(
        { success: false, message: "No Delivery Boy profile linked to this account. Please contact the administrator." },
        { status: 403 }
      );
    }

    // Assume one-to-many relationship but we just grab the first active one
    const activeProfile = admin.deliveryBoyProfiles.find(p => p.active);
    if (!activeProfile) {
      return NextResponse.json(
        { success: false, message: "Your delivery profile is currently inactive." },
        { status: 403 }
      );
    }

    // Generate JWT Token
    const token = jwt.sign(
      {
        adminId: admin.id,
        deliveryBoyId: activeProfile.id,
        role: admin.role.name,
      },
      JWT_SECRET,
      { expiresIn: "7d" } // Token expires in 7 days
    );

    return NextResponse.json({
      success: true,
      token,
      profile: {
        id: activeProfile.id,
        name: activeProfile.name,
        phone: activeProfile.phone,
        email: admin.email,
        username: admin.username
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
