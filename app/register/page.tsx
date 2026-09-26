import type { Metadata } from 'next';
import { RegistrationForm } from '@/components/register/RegistrationForm';

/**
 * The public registration link. No session, no invite token, no auth gate
 * - middleware.ts lists /register as public, which is the whole point:
 * this is the page a vendor or a client is sent when nobody at AQ has a
 * record of them yet.
 *
 * The old form lived on a service that has been closed down, so until
 * this exists every new vendor and client arrives by email and is typed
 * in by hand.
 *
 * Not indexed. It is a form for people who were given the link, not a
 * page for anyone who searches.
 */
export const metadata: Metadata = {
  title: 'Register — AQ Creativity',
  description: 'Register as a vendor or a client with AQ Creativity.',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegistrationForm />;
}
