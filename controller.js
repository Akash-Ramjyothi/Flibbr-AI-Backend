// src/server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
});
app.use('/api', limiter);

// Authentication middleware
interface AuthRequest extends express.Request {
  userId?: string;
}

const authenticateToken = async (
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    
    // Verify session exists and is not expired
    const session = await prisma.session.findFirst({
      where: {
        token,
        userId: decoded.userId,
        expiresAt: { gt: new Date() }
      }
    });

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// ==================== API Endpoints ====================

// 1.1 User Sign Up
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        email
      }
    });

    res.status(201).json({
      message: 'User registered successfully',
      userId: user.id,
      username: user.username
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 1.2 User Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    // Store session
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      username: user.username
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2.1 Get all chats for user
app.get('/api/chats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { page = 1, limit = 20, archived = false } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const chats = await prisma.chat.findMany({
      where: {
        userId: req.userId,
        isArchived: archived === 'true'
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true }
        }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: Number(limit)
    });

    const total = await prisma.chat.count({
      where: { userId: req.userId, isArchived: archived === 'true' }
    });

    const formattedChats = chats.map(chat => ({
      chatId: chat.id,
      title: chat.title,
      lastMessage: chat.messages[0]?.content || 'No messages yet',
      lastMessageTime: chat.messages[0]?.createdAt,
      updatedAt: chat.updatedAt,
      isArchived: chat.isArchived,
      messageCount: chat._count?.messages || 0
    }));

    res.json({
      chats: formattedChats,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2.2 Fetch all messages of a single chat
app.get('/api/chats/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify chat belongs to user
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: req.userId
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const messages = await prisma.message.findMany({
      where: { chatId },
      include: {
        reactions: {
          include: { user: { select: { username: true, id: true } } }
        }
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: Number(limit)
    });

    const total = await prisma.message.count({ where: { chatId } });

    const formattedMessages = messages.map(msg => ({
      messageId: msg.id,
      sender: msg.sender,
      content: msg.content,
      timestamp: msg.createdAt,
      reactions: msg.reactions.reduce((acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      userReaction: msg.reactions.find(r => r.userId === req.userId)?.type
    }));

    res.json({
      chatId: chat.id,
      title: chat.title,
      messages: formattedMessages,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get chat messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3.1 Start new chat
app.post('/api/chats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { title } = req.body;

    const chat = await prisma.chat.create({
      data: {
        userId: req.userId!,
        title: title || `New Chat ${new Date().toLocaleString()}`
      }
    });

    // Add welcome message from bot
    await prisma.message.create({
      data: {
        chatId: chat.id,
        sender: 'BOT',
        content: "Hello! I'm your AI assistant. How can I help you today?"
      }
    });

    res.status(201).json({
      message: 'Chat created successfully',
      chatId: chat.id,
      title: chat.title
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3.2 Send Message to Chat Bot
app.post('/api/chats/:chatId/messages', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message content required' });
    }

    // Verify chat belongs to user
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: req.userId
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        chatId,
        sender: 'USER',
        content: message
      }
    });

    // Generate bot response (enhanced AI response)
    const botResponse = await generateBotResponse(message, chatId, req.userId!);

    // Save bot response
    const botMessage = await prisma.message.create({
      data: {
        chatId,
        sender: 'BOT',
        content: botResponse,
        metadata: {
          model: 'gpt-3.5-turbo',
          timestamp: new Date().toISOString()
        }
      }
    });

    // Update chat's updatedAt
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() }
    });

    // Broadcast via WebSocket if client is connected
    broadcastMessage(req.userId!, {
      type: 'new_message',
      chatId,
      message: {
        messageId: botMessage.id,
        sender: 'BOT',
        content: botResponse,
        timestamp: botMessage.createdAt
      }
    });

    res.status(201).json({
      message: 'Message sent successfully',
      chatId,
      userMessageId: userMessage.id,
      botMessageId: botMessage.id,
      userMessage: message,
      botResponse
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. React to responses
app.post('/api/chats/:chatId/messages/:messageId/reactions', 
  authenticateToken, 
  async (req: AuthRequest, res) => {
    try {
      const { chatId, messageId } = req.params;
      const { reaction } = req.body;

      const validReactions = ['LIKE', 'DISLIKE', 'LOVE', 'LAUGH', 'SAD', 'ANGRY'];
      if (!reaction || !validReactions.includes(reaction.toUpperCase())) {
        return res.status(400).json({ 
          error: 'Invalid reaction. Valid: like, dislike, love, laugh, sad, angry' 
        });
      }

      // Verify message belongs to user's chat
      const message = await prisma.message.findFirst({
        where: {
          id: messageId,
          chat: {
            id: chatId,
            userId: req.userId
          }
        }
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Upsert reaction
      const userReaction = await prisma.reaction.upsert({
        where: {
          messageId_userId: {
            messageId,
            userId: req.userId!
          }
        },
        update: {
          type: reaction.toUpperCase() as any
        },
        create: {
          messageId,
          userId: req.userId!,
          type: reaction.toUpperCase() as any
        }
      });

      res.json({
        message: 'Reaction added/updated successfully',
        chatId,
        messageId,
        reaction: reaction.toLowerCase(),
        timestamp: userReaction.createdAt
      });
    } catch (error) {
      console.error('Add reaction error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

// Additional Enhanced Endpoints

// Delete chat
app.delete('/api/chats/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { chatId } = req.params;

    const result = await prisma.chat.deleteMany({
      where: {
        id: chatId,
        userId: req.userId
      }
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Archive/Unarchive chat
app.patch('/api/chats/:chatId/archive', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { chatId } = req.params;
    const { archived } = req.body;

    const chat = await prisma.chat.updateMany({
      where: {
        id: chatId,
        userId: req.userId
      },
      data: { isArchived: archived }
    });

    if (chat.count === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ 
      message: `Chat ${archived ? 'archived' : 'unarchived'} successfully`,
      chatId,
      isArchived: archived
    });
  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search messages
app.get('/api/search', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const messages = await prisma.message.findMany({
      where: {
        chat: { userId: req.userId },
        content: { contains: q as string, mode: 'insensitive' }
      },
      include: {
        chat: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit)
    });

    res.json({
      query: q,
      results: messages.map(msg => ({
        messageId: msg.id,
        chatId: msg.chatId,
        chatTitle: msg.chat.title,
        content: msg.content,
        sender: msg.sender,
        timestamp: msg.createdAt
      }))
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile
app.get('/api/user/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            chats: true,
            reactions: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
app.post('/api/logout', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      await prisma.session.deleteMany({
        where: { token }
      });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== Helper Functions ====================

async function generateBotResponse(userMessage: string, chatId: string, userId: string): Promise<string> {
  // This is where you would integrate with an AI service like OpenAI
  // For demo purposes, returning enhanced responses based on keywords
  
  const lowerMsg = userMessage.toLowerCase();
  
  // Get conversation context (last 5 messages)
  const recentMessages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  
  // Simple rule-based response system (replace with actual AI)
  if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
    return "Hello! How are you doing today?";
  } else if (lowerMsg.includes('how are you')) {
    return "I'm doing great, thank you for asking! How can I assist you today?";
  } else if (lowerMsg.includes('features') || lowerMsg.includes('flibbr')) {
    return "Flibbr AI offers: \n• Natural language processing\n• Contextual conversations\n• Multi-language support\n• Customizable responses\n• Analytics dashboard\n• Integration APIs";
  } else if (lowerMsg.includes('help')) {
    return "I can help you with:\n- Answering questions\n- Having conversations\n- Providing information\n- Assisting with tasks\nWhat would you like to know?";
  } else if (lowerMsg.includes('thank')) {
    return "You're welcome! Is there anything else I can help you with?";
  } else if (lowerMsg.includes('bye') || lowerMsg.includes('goodbye')) {
    return "Goodbye! Feel free to come back if you need any help!";
  } else {
    return `Thanks for your message: "${userMessage}". I'm here to help! Could you please provide more details or ask a specific question?`;
  }
}

// WebSocket connections management
const userConnections = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('token');
  
  if (!token) {
    ws.close(1008, 'No token provided');
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId)!.add(ws);
    
    ws.on('close', () => {
      userConnections.get(userId)?.delete(ws);
      if (userConnections.get(userId)?.size === 0) {
        userConnections.delete(userId);
      }
    });
  } catch (error) {
    ws.close(1008, 'Invalid token');
  }
});

function broadcastMessage(userId: string, data: any) {
  const connections = userConnections.get(userId);
  if (connections) {
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
});

export { app, prisma };
