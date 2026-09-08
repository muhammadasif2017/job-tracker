import { redirect } from 'next/navigation';

// The sidebar links straight to /admin/users, but /admin is what people type
// and what the tab strip's own base path looks like — land them on the first
// tab rather than a 404.
export default function AdminIndexPage() {
  redirect('/admin/users');
}
