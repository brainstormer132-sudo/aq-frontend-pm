'use client';

import { useEffect, useState } from 'react';
import { PortalShell, Icon, type PortalView } from '@/components/portal/PortalShell';
import { portal, type PortalMe } from '@/lib/portal-api';
import { PortalOverview } from '@/components/portal/PortalOverview';
import { PortalDocuments } from '@/components/portal/PortalDocuments';
import { PortalProfile } from '@/components/portal/PortalProfile';
import { PortalHelp } from '@/components/portal/PortalHelp';

/**
 * Vendor portal entry. Declares which views render in the sidebar and
 * defers everything else (auth, password gate, layout, view switching)
 * to PortalShell.
 */
export default function VendorPortalPage() {
  const [contractCount, setContractCount] = useState<number | undefined>();
  useEffect(() => {
    portal.contracts().then((rs) => setContractCount(rs.length)).catch(() => {});
  }, []);

  const buildViews = (me: PortalMe, navigate: (viewId: string) => void): PortalView[] => {
    if (me.role !== 'vendor') return [];
    return [
      {
        id: 'overview',
        label: 'Overview',
        icon: <Icon.Home />,
        render: () => <PortalOverview me={me} onSeeAll={() => navigate('documents')} />,
      },
      {
        id: 'documents',
        label: 'Contracts',
        icon: <Icon.Doc />,
        count: contractCount,
        render: () => <PortalDocuments me={me} />,
      },
      {
        id: 'profile',
        label: 'Profile & banking',
        icon: <Icon.User />,
        render: () => <PortalProfile me={me} onRequestChange={() => navigate('help')} />,
      },
      {
        id: 'help',
        label: 'Help & contact',
        icon: <Icon.Help />,
        render: () => <PortalHelp me={me} />,
      },
    ];
  };

  return <PortalShell expectedRole="vendor" buildViews={buildViews} />;
}
