"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Camera, KeyRound, LogOut, Pencil, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import ProfileView from "@/components/ProfileView";
import { Avatar, Sheet, toast } from "@/components/ui";
import { errMsg, sb } from "@/lib/supabase";

/** Crops a photo to a square and saves it sharp enough for the full-screen view
 *  (up to 1024px), while staying under the storage limit of 1 MB. */
async function squareImage(file: File, maxSize = 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(maxSize, side); // never upscale small photos
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  const toJpeg = (q: number) =>
    new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read image"))), "image/jpeg", q));
  for (const q of [0.9, 0.82, 0.72, 0.6]) {
    const blob = await toJpeg(q);
    if (blob.size < 950_000) return blob;
  }
  return toJpeg(0.5);
}

export default function MyProfilePage() {
  const { me, reload } = useApp();
  const [editing, setEditing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [name, setName] = useState(me.display_name);
  const [bio, setBio] = useState(me.bio ?? "");
  const [avatar, setAvatar] = useState(me.avatar_url);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const blob = await squareImage(file);
      const path = `${me.id}/avatar.jpg`;
      const { error } = await sb().storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      const url = sb().storage.from("avatars").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
      setAvatar(url);
    } catch (e) {
      toast.err(errMsg(e));
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    const { error } = await sb().from("profiles")
      .update({ display_name: name.trim() || me.username, bio: bio.trim() || null, avatar_url: avatar }).eq("id", me.id);
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    await reload();
    setEditing(false);
    toast.ok("Profile saved");
  };

  const changePw = async () => {
    if (pw.length < 6) return toast.err("At least 6 characters");
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    setPw(""); setPwOpen(false);
    toast.ok("Password changed");
  };

  return (
    <>
      <div className="pt-safe" />
      <ProfileView profile={me} actions={
        <div className="flex justify-center gap-2">
          <button className="btn btn-ghost py-2.5 text-sm" onClick={() => { setName(me.display_name); setBio(me.bio ?? ""); setAvatar(me.avatar_url); setEditing(true); }}>
            <Pencil className="h-4 w-4" /> Edit profile
          </button>
          {me.is_admin && (
            <Link href="/admin" className="btn btn-ghost py-2.5 text-sm text-emerald-300"><ShieldCheck className="h-4 w-4" /> Admin</Link>
          )}
        </div>
      } />

      <section className="card mt-6 divide-y divide-white/[0.06]">
        <button onClick={() => setPwOpen(true)} className="flex w-full items-center gap-3 px-4 py-4 text-left font-semibold">
          <KeyRound className="h-5 w-5 text-mute" /> Change password
        </button>
        <button onClick={() => sb().auth.signOut()} className="flex w-full items-center gap-3 px-4 py-4 text-left font-semibold text-rose-400">
          <LogOut className="h-5 w-5" /> Sign out
        </button>
      </section>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div className="flex flex-col items-center">
          <button onClick={() => fileRef.current?.click()} className="relative" disabled={busy}>
            <Avatar name={name || me.username} url={avatar} size={110} ring="#ff4d8d" />
            <span className="absolute right-0 bottom-0 grid h-9 w-9 place-items-center rounded-full bg-white text-black shadow-lg">
              <Camera className="h-5 w-5" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          {avatar && <button className="mt-2 text-xs font-semibold text-mute underline" onClick={() => setAvatar(null)}>Remove photo</button>}
        </div>
        <label className="mt-5 block text-xs font-bold text-mute">Display name
          <input className="field mt-1" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-bold text-mute">Bio
          <input className="field mt-1" maxLength={120} placeholder="Gym rat. Skincare enjoyer." value={bio} onChange={(e) => setBio(e.target.value)} />
        </label>
        <button className="btn btn-primary mt-5 w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </Sheet>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <input className="field" type="password" placeholder="New password (6+ characters)" autoComplete="new-password"
          value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={changePw}>Update password</button>
      </Sheet>
    </>
  );
}
