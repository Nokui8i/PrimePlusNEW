'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { UserProfile } from '@/lib/types/user';
import { collection, query, where, onSnapshot, orderBy, Timestamp, doc, getDoc, getDocs, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { auth } from '@/lib/firebase/config';

interface ChatWindow {
  id: string;
  user: UserProfile;
  isMinimized: boolean;
  position: { x: number; y: number };
  unreadCount: number;
}

interface ChatContextType {
  chatWindows: ChatWindow[];
  openChat: (user: UserProfile) => void;
  closeChat: (userId: string) => void;
  minimizeChat: (userId: string) => void;
  updatePosition: (userId: string, position: { x: number; y: number }) => void;
  markAsRead: (userId: string) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);
  const [closedChats, setClosedChats] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('closedChats');
      if (stored) return new Set(JSON.parse(stored));
    }
    return new Set();
  });
  const { user } = useAuth();
  const [lastSeenMessageIds, setLastSeenMessageIds] = useState<Record<string, string>>({});

  // Persist closedChats to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('closedChats', JSON.stringify(Array.from(closedChats)));
    }
  }, [closedChats]);

  // Listen for new messages in all user chats
  useEffect(() => {
    if (!user) return;

    // Listen to all chats where the user is a participant
    const chatsQuery = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid)
    );

    const chatUnsubscribes: (() => void)[] = [];

    const unsubscribeChats = onSnapshot(chatsQuery, (chatsSnapshot) => {
      chatsSnapshot.forEach((chatDoc) => {
        const chatId = chatDoc.id;
        const chatData = chatDoc.data();
        const otherParticipantId = (chatData.participants as string[]).find((id) => id !== user.uid);
        if (!otherParticipantId) return;

        // Skip if this chat is in closedChats
        if (closedChats.has(otherParticipantId)) {
          return;
        }

        // Listen to new messages in this chat
        const messagesQuery = query(
          collection(db, 'chats', chatId, 'messages'),
          orderBy('timestamp', 'desc'),
        );
        const unsubscribeMessages = onSnapshot(messagesQuery, async (messagesSnapshot) => {
          // Only consider the latest message
          const latestDoc = messagesSnapshot.docs[0];
          if (!latestDoc) return;
          const messageData = latestDoc.data();
          const senderId = messageData.senderId;
          if (senderId === user.uid) return; // Ignore own messages

          // Only process if this message is new
          if (lastSeenMessageIds[chatId] === latestDoc.id) return;
          setLastSeenMessageIds(prev => ({ ...prev, [chatId]: latestDoc.id }));

          // Check if chat window already exists
          const existingWindow = chatWindows.find(window => window.user.uid === senderId);
          if (!existingWindow) {
            // Fetch sender's real profile from Firestore
            let senderUser: UserProfile;
            try {
              const senderDoc = await getDoc(doc(db, 'users', senderId));
              if (senderDoc.exists()) {
                const senderProfile = senderDoc.data();
                senderUser = {
                  id: senderId,
                  uid: senderId,
                  displayName: senderProfile.displayName || messageData.senderName,
                  username: senderProfile.username || senderId,
                  photoURL: senderProfile.photoURL || messageData.senderPhotoURL || '',
                  email: senderProfile.email || '',
                  createdAt: senderProfile.createdAt || Timestamp.now(),
                  updatedAt: senderProfile.updatedAt || Timestamp.now(),
                  isAgeVerified: senderProfile.isAgeVerified || false,
                  isVerified: senderProfile.isVerified || false,
                  role: senderProfile.role || 'user',
                  status: senderProfile.status || 'active',
                };
              } else {
                senderUser = {
                  id: senderId,
                  uid: senderId,
                  displayName: messageData.senderName,
                  username: messageData.senderName,
                  photoURL: messageData.senderPhotoURL || '',
                  email: '',
                  createdAt: Timestamp.now(),
                  updatedAt: Timestamp.now(),
                  isAgeVerified: false,
                  isVerified: false,
                  role: 'user',
                  status: 'active',
                };
              }
            } catch {
              senderUser = {
                id: senderId,
                uid: senderId,
                displayName: messageData.senderName,
                username: messageData.senderName,
                photoURL: messageData.senderPhotoURL || '',
                email: '',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                isAgeVerified: false,
                isVerified: false,
                role: 'user',
                status: 'active',
              };
            }
            setChatWindows(prev => [
              ...prev,
              {
                id: senderId,
                user: senderUser,
                isMinimized: true, // minimized by default
                position: {
                  x: Math.max(0, window.innerWidth - 320 - (prev.length * 20)),
                  y: Math.max(0, window.innerHeight - 400 - (prev.length * 20))
                },
                unreadCount: 1
              }
            ]);
            return;
          } else {
            // Update existing window with unread count
            setChatWindows(prev => prev.map(window => 
              window.user.uid === senderId
                ? { ...window, unreadCount: (window.unreadCount || 0) + 1 }
                : window
            ));
          }
        });
        chatUnsubscribes.push(unsubscribeMessages);
      });
    });
    chatUnsubscribes.push(unsubscribeChats);

    return () => {
      chatUnsubscribes.forEach(unsub => unsub());
    };
  }, [user, chatWindows, closedChats]);

  const openChat = (user: UserProfile) => {
    console.log('openChat called for', user.uid);
    setChatWindows(prev => {
      // If chat already exists, just un-minimize it and clear unread count
      if (prev.some(window => window.user.uid === user.uid)) {
        return prev.map(window => 
          window.user.uid === user.uid 
            ? { ...window, isMinimized: false, unreadCount: 0 }
            : window
        );
      }

      // Calculate position for new chat window
      const newPosition = {
        x: Math.max(0, window.innerWidth - 320 - (prev.length * 20)),
        y: Math.max(0, window.innerHeight - 400 - (prev.length * 20))
      };

      // Ensure the window is not minimized when first opened
      const newWindows = [...prev, {
        id: user.uid,
        user,
        isMinimized: false,
        position: newPosition,
        unreadCount: 0
      }];
      console.log('chatWindows after openChat:', newWindows);
      return newWindows;
    });
  };

  const closeChat = (userId: string) => {
    console.log('Closing chat for user:', userId);
    // First remove from chatWindows
    setChatWindows(prev => {
      const newWindows = prev.filter(window => window.user.uid !== userId);
      console.log('Updated chat windows:', newWindows);
      return newWindows;
    });
    
    // Then add to closedChats
    setClosedChats(prev => {
      const newClosedChats = new Set([...Array.from(prev), userId]);
      console.log('Updated closed chats:', Array.from(newClosedChats));
      return newClosedChats;
    });

    // Clean up any existing listeners for this chat
    if (user) {
      const chatId = [user.uid, userId].sort().join('_');
      const chatRef = doc(db, 'chats', chatId);
      // Remove typing status
      setDoc(chatRef, { typing: null }, { merge: true }).catch(console.error);
    }
  };

  const minimizeChat = (userId: string) => {
    setChatWindows(prev => 
      prev.map(window => 
        window.user.uid === userId 
          ? { ...window, isMinimized: !window.isMinimized }
          : window
      )
    );
  };

  const updatePosition = (userId: string, position: { x: number; y: number }) => {
    setChatWindows(prev => 
      prev.map(window => 
        window.user.uid === userId 
          ? { ...window, position }
          : window
      )
    );
  };

  const markAsRead = async (userId: string) => {
    // Update local state
    setChatWindows(prev => 
      prev.map(window => 
        window.user.uid === userId 
          ? { ...window, unreadCount: 0 }
          : window
      )
    );

    // Update Firestore
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const chatId = [currentUser.uid, userId].sort().join('_');
      const messagesRef = collection(db, 'chats', chatId, 'messages');
      const unreadQuery = query(
        messagesRef,
        where('senderId', '==', userId),
        where('read', '==', false)
      );
      
      const snapshot = await getDocs(unreadQuery);
      const batch = writeBatch(db);
      
      snapshot.forEach((docSnap) => {
        batch.update(docSnap.ref, { 
          read: true,
          status: 'read'
        });
      });
      
      if (!snapshot.empty) {
        await batch.commit();
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

  return (
    <ChatContext.Provider value={{
      chatWindows,
      openChat,
      closeChat,
      minimizeChat,
      updatePosition,
      markAsRead
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
} 