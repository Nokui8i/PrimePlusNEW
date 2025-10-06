'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import Link from 'next/link';
import { MessagePopup } from './messages/MessagePopup';
import { UserProfile } from '@/lib/types/user';
import { Button } from '@/components/ui/button';
import { FiMessageSquare } from 'react-icons/fi';
import { SuggestedCreators } from '@/components/sidebar/SuggestedCreators';
import { usePathname } from 'next/navigation';

interface RightSidebarProps {
  suggestedCreators: UserProfile[];
  trendingTopics: { id: string; name: string; postCount: number }[];
  isLoading: boolean;
}

export function RightSidebar({ suggestedCreators, trendingTopics, isLoading }: RightSidebarProps) {
  const [isMessagePopupOpen, setIsMessagePopupOpen] = useState(false);
  const pathname = usePathname();
  const isMessagesPage = pathname === '/messages';

  return (
    <div className="w-80 bg-white p-6 space-y-8">
      {/* Hide Suggested Creators on messages page */}
      {!isMessagesPage && <SuggestedCreators />}

      <MessagePopup
        isOpen={isMessagePopupOpen}
        onClose={() => setIsMessagePopupOpen(false)}
      />
    </div>
  );
} 