// backend/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand, ConfirmSignUpCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand, ResendConfirmationCodeCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(require('cors')({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// AWS Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;

// Initialize AWS clients
const cognitoClient = new CognitoIdentityProviderClient({ region: AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// DynamoDB table names
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || 'vybe-users';
const PROJECTS_TABLE = process.env.DYNAMODB_PROJECTS_TABLE || 'vybe-projects';
const COLLABORATORS_TABLE = process.env.DYNAMODB_COLLABORATORS_TABLE || 'vybe-project-collaborators';
const BEATS_TABLE = process.env.DYNAMODB_BEATS_TABLE || 'vybe-beats';

// JWKS client for token verification
const client = jwksClient({
  jwksUri: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    }
  });
}

// Helper: Calculate SECRET_HASH for Cognito
const crypto = require('crypto');
function calculateSecretHash(username) {
  return crypto
    .createHmac('SHA256', COGNITO_CLIENT_SECRET)
    .update(username + COGNITO_CLIENT_ID)
    .digest('base64');
}

// Middleware: Verify JWT token
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
}

// ==================== Authentication Endpoints ====================

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, phone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new SignUpCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      SecretHash: secretHash,
      UserAttributes: [
        { Name: 'email', Value: email }
      ]
    });

    const response = await cognitoClient.send(command);

    // Create user record in DynamoDB
    const userId = response.UserSub;
    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        userId,
        email,
        displayName: email.split('@')[0],
        createdAt: new Date().toISOString(),
        lastLogin: null,
        profilePictureUrl: null
      }
    }));

    res.json({
      message: 'User created successfully. Please verify your email.',
      userId
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ message: error.message || 'Signup failed' });
  }
});

// Sign In
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: secretHash
      }
    });

    const response = await cognitoClient.send(command);

    // Decode token to get userId
    const decoded = jwt.decode(response.AuthenticationResult.IdToken);
    const userId = decoded.sub;

    // Update last login in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'SET lastLogin = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString()
      }
    }));

    res.json({
      message: 'Sign in successful',
      idToken: response.AuthenticationResult.IdToken,
      accessToken: response.AuthenticationResult.AccessToken,
      refreshToken: response.AuthenticationResult.RefreshToken,
      userId
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(401).json({ message: error.message || 'Sign in failed' });
  }
});

// Request Password Reset
app.post('/api/auth/request-password-reset', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new ForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      SecretHash: secretHash
    });

    await cognitoClient.send(command);
    res.json({ message: 'Password reset code sent to your email' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(400).json({ message: error.message || 'Password reset request failed' });
  }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, password } = req.body;

  if (!email || !code || !password) {
    return res.status(400).json({ message: 'Email, code, and new password are required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new ConfirmForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: password,
      SecretHash: secretHash
    });

    await cognitoClient.send(command);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(400).json({ message: error.message || 'Password reset failed' });
  }
});

// Request Email Verification Code
app.post('/api/auth/request-email-code', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new ResendConfirmationCodeCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      SecretHash: secretHash
    });

    await cognitoClient.send(command);
    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Resend code error:', error);
    res.status(400).json({ message: error.message || 'Failed to send verification code' });
  }
});

// Verify Email Code
app.post('/api/auth/verify-email-code', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and code are required' });
  }

  try {
    const secretHash = calculateSecretHash(email);

    const command = new ConfirmSignUpCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      SecretHash: secretHash
    });

    await cognitoClient.send(command);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({ message: error.message || 'Email verification failed' });
  }
});

// Phone verification endpoints (placeholders - similar implementation)
app.post('/api/auth/request-phone-code', async (req, res) => {
  res.status(501).json({ message: 'Phone verification not yet implemented' });
});

app.post('/api/auth/verify-phone-code', async (req, res) => {
  res.status(501).json({ message: 'Phone verification not yet implemented' });
});

// ==================== User Endpoints ====================

// Get user profile
app.get('/api/user/:userId', verifyToken, async (req, res) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: req.params.userId }
    }));

    if (!result.Item) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.Item);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to get user' });
  }
});

// Update user profile
app.put('/api/user/:userId', verifyToken, async (req, res) => {
  const { displayName, profilePictureUrl } = req.body;

  if (req.user.sub !== req.params.userId) {
    return res.status(403).json({ message: 'Unauthorized' });
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: req.params.userId },
      UpdateExpression: 'SET displayName = :name, profilePictureUrl = :pic',
      ExpressionAttributeValues: {
        ':name': displayName,
        ':pic': profilePictureUrl
      }
    }));

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// ==================== Project Endpoints ====================

// Create project
app.post('/api/projects', verifyToken, async (req, res) => {
  const { name, bpm } = req.body;
  const userId = req.user.sub;

  try {
    const projectId = uuidv4();
    const now = new Date().toISOString();

    // Create project
    await docClient.send(new PutCommand({
      TableName: PROJECTS_TABLE,
      Item: {
        projectId,
        name: name || 'Untitled Project',
        ownerId: userId,
        bpm: bpm || 120,
        createdAt: now,
        updatedAt: now,
        collaboratorCount: 1
      }
    }));

    // Add owner as collaborator
    await docClient.send(new PutCommand({
      TableName: COLLABORATORS_TABLE,
      Item: {
        projectId,
        userId,
        role: 'owner',
        addedAt: now,
        addedBy: userId
      }
    }));

    // Initialize empty beat data
    await docClient.send(new PutCommand({
      TableName: BEATS_TABLE,
      Item: {
        projectId,
        beatData: JSON.stringify([[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]),
        version: 0,
        updatedAt: now,
        updatedBy: userId
      }
    }));

    res.json({ projectId, message: 'Project created successfully' });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ message: 'Failed to create project' });
  }
});

// Get user's projects
app.get('/api/projects/user/:userId', verifyToken, async (req, res) => {
  try {
    // Get projects where user is collaborator
    const collaboratorResult = await docClient.send(new QueryCommand({
      TableName: COLLABORATORS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': req.params.userId
      }
    }));

    // Get full project details
    const projects = await Promise.all(
      collaboratorResult.Items.map(async (collab) => {
        const projectResult = await docClient.send(new GetCommand({
          TableName: PROJECTS_TABLE,
          Key: { projectId: collab.projectId }
        }));
        return { ...projectResult.Item, userRole: collab.role };
      })
    );

    res.json(projects);
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ message: 'Failed to get projects' });
  }
});

// Get project by ID
app.get('/api/projects/:projectId', verifyToken, async (req, res) => {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId: req.params.projectId }
    }));

    if (!result.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.json(result.Item);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ message: 'Failed to get project' });
  }
});

// ==================== WebSocket Server ====================

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// WebSocket authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
    socket.userId = decoded.sub;
    socket.userEmail = decoded.email;
    next();
  });
});

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id, '- User:', socket.userEmail);

  socket.on('join-room', async (roomName) => {
    // Verify user has access to this project
    const projectId = roomName.replace('beat-room-', '');

    try {
      const result = await docClient.send(new GetCommand({
        TableName: COLLABORATORS_TABLE,
        Key: { projectId, userId: socket.userId }
      }));

      if (!result.Item) {
        socket.emit('error', { message: 'Unauthorized: You are not a collaborator on this project' });
        return;
      }

      socket.join(roomName);
      console.log(`User ${socket.userEmail} joined room: ${roomName}`);

      // Notify others in room
      socket.to(roomName).emit('user-joined', {
        userId: socket.userId,
        email: socket.userEmail
      });
    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Relay Y.js sync messages between clients
  socket.on('yjs-message', ({ room, message }) => {
    socket.to(room).emit('yjs-message', message);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id, '- User:', socket.userEmail);
  });
});

// ==================== Start Server ====================

const PORT = process.env.PORT || 1234;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Ready for real-time collaboration!`);
  console.log(`🔐 Authentication enabled with AWS Cognito`);
});
