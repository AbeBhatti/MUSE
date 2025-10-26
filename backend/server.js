// backend/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand, ConfirmSignUpCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand, ResendConfirmationCodeCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

// Initialize Express app
const app = express();
const path = require('path');
const fs = require('fs');

// Serve static files: prefer built assets if available
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
const publicDir = path.join(__dirname, '..', 'frontend');
const staticOptions = {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath);
    if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext)) {
      res.type('application/javascript');
    }
    if (ext === '.json') {
      res.type('application/json');
    }
  }
};
// Serve from dist directory first (built assets take priority)
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, staticOptions));
}
// Always serve from public directory as fallback (for non-built files like collab-client.js)
app.use(express.static(publicDir, staticOptions));

// Tighten CSP for MIDI editor pages (no external scripts/styles required)
app.use((req, res, next) => {
  // Apply strict CSP only for the Vite-based page, which uses bundled local assets
  if (req.path.includes('midi-editor-vite')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://localhost:1234; font-src 'self' data:");
  }
  next();
});

app.use(express.json());
app.use(require('cors')({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Audio stem separation endpoint
app.use('/stems', require('./routes/stems'));

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
  if (!COGNITO_CLIENT_SECRET) return undefined;
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
    const params = {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email }
      ]
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      params.SecretHash = secretHash;
    }

    const command = new SignUpCommand(params);

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
    res.status(400).json({
      message: error.message || 'Signup failed',
      code: error.name || error.code || 'SignupError'
    });
  }
});

// Sign In
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const authParams = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      authParams.AuthParameters.SECRET_HASH = secretHash;
    }

    const command = new InitiateAuthCommand(authParams);

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
    res.status(401).json({
      message: error.message || 'Sign in failed',
      code: error.name || error.code || 'SignInError'
    });
  }
});

// ==================== Health Check Endpoint ====================

// Health check endpoint for ECS
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ==================== MIDI Transcription Endpoints ====================
app.use('/', require('./routes/midi'));

// Request Password Reset
app.post('/api/auth/request-password-reset', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const params = {
      ClientId: COGNITO_CLIENT_ID,
      Username: email
    };
    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      params.SecretHash = secretHash;
    }

    const command = new ForgotPasswordCommand(params);

    await cognitoClient.send(command);
    res.json({ message: 'Password reset code sent to your email' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(400).json({
      message: error.message || 'Password reset request failed',
      code: error.name || error.code || 'ForgotPasswordError'
    });
  }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, password } = req.body;

  if (!email || !code || !password) {
    return res.status(400).json({ message: 'Email, code, and new password are required' });
  }

  try {
    const params = {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: password
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      params.SecretHash = secretHash;
    }

    const command = new ConfirmForgotPasswordCommand(params);

    await cognitoClient.send(command);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(400).json({
      message: error.message || 'Password reset failed',
      code: error.name || error.code || 'ResetPasswordError'
    });
  }
});

// Request Email Verification Code
app.post('/api/auth/request-email-code', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const params = {
      ClientId: COGNITO_CLIENT_ID,
      Username: email
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      params.SecretHash = secretHash;
    }

    const command = new ResendConfirmationCodeCommand(params);

    await cognitoClient.send(command);
    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Resend code error:', error);
    res.status(400).json({
      message: error.message || 'Failed to send verification code',
      code: error.name || error.code || 'ResendEmailCodeError'
    });
  }
});

// Verify Email Code
app.post('/api/auth/verify-email-code', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and code are required' });
  }

  try {
    const params = {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code
    };

    const secretHash = calculateSecretHash(email);
    if (secretHash) {
      params.SecretHash = secretHash;
    }

    const command = new ConfirmSignUpCommand(params);

    await cognitoClient.send(command);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({
      message: error.message || 'Email verification failed',
      code: error.name || error.code || 'VerifyEmailCodeError'
    });
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

// Soft delete project (move to trash)
app.delete('/api/projects/:projectId', verifyToken, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.sub;

  try {
    // Verify ownership
    const projectResult = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    if (!projectResult.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (projectResult.Item.ownerId !== userId) {
      return res.status(403).json({ message: 'Only the project owner can delete projects' });
    }

    // Soft delete by setting deleted flag
    await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: 'SET deleted = :true, deletedAt = :now',
      ExpressionAttributeValues: {
        ':true': true,
        ':now': new Date().toISOString()
      }
    }));

    res.json({ message: 'Project moved to trash' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ message: 'Failed to delete project' });
  }
});

// Restore project from trash
app.post('/api/projects/:projectId/restore', verifyToken, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.sub;

  try {
    // Verify ownership
    const projectResult = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    if (!projectResult.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (projectResult.Item.ownerId !== userId) {
      return res.status(403).json({ message: 'Only the project owner can restore projects' });
    }

    // Remove deleted flag
    await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: 'REMOVE deleted, deletedAt'
    }));

    res.json({ message: 'Project restored' });
  } catch (error) {
    console.error('Restore project error:', error);
    res.status(500).json({ message: 'Failed to restore project' });
  }
});

// Permanently delete project
app.delete('/api/projects/:projectId/permanent', verifyToken, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.sub;

  try {
    // Verify ownership
    const projectResult = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    if (!projectResult.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (projectResult.Item.ownerId !== userId) {
      return res.status(403).json({ message: 'Only the project owner can permanently delete projects' });
    }

    // Delete project
    await docClient.send(new DeleteCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    // Delete all collaborators
    const collaboratorsResult = await docClient.send(new QueryCommand({
      TableName: COLLABORATORS_TABLE,
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: {
        ':projectId': projectId
      }
    }));

    for (const collab of collaboratorsResult.Items || []) {
      await docClient.send(new DeleteCommand({
        TableName: COLLABORATORS_TABLE,
        Key: { projectId, userId: collab.userId }
      }));
    }

    // Delete beat data
    await docClient.send(new DeleteCommand({
      TableName: BEATS_TABLE,
      Key: { projectId }
    }));

    res.json({ message: 'Project permanently deleted' });
  } catch (error) {
    console.error('Permanent delete project error:', error);
    res.status(500).json({ message: 'Failed to permanently delete project' });
  }
});

// Invite user to project
app.post('/api/projects/:projectId/invite', verifyToken, async (req, res) => {
  const { projectId } = req.params;
  const { email, role } = req.body;
  const inviterId = req.user.sub;

  if (!email || !role) {
    return res.status(400).json({ message: 'Email and role are required' });
  }

  // 1. Find the user by email to get their userId
  let userId;
  try {
    const userResult = await docClient.send(new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: 'email-index', // Assumes a GSI on the email field
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }));

    if (!userResult.Items || userResult.Items.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    userId = userResult.Items[0].userId;
  } catch (error) {
    // Handle potential error if the email-index GSI doesn't exist
    if (error.name === 'ValidationException') {
      // Fallback to a scan if GSI is not available
      try {
        const scanResult = await docClient.send(new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: 'email = :email',
          ExpressionAttributeValues: {
            ':email': email
          }
        }));
        if (!scanResult.Items || scanResult.Items.length === 0) {
          return res.status(404).json({ message: 'User not found' });
        }
        userId = scanResult.Items[0].userId;
      } catch (scanError) {
        console.error('Error finding user by email (scan fallback):', scanError);
        return res.status(500).json({ message: 'Failed to find user' });
      }
    } else {
      console.error('Error finding user by email:', error);
      return res.status(500).json({ message: 'Failed to find user' });
    }
  }


  // 2. Add the user to the collaborators table
  try {
    await docClient.send(new PutCommand({
      TableName: COLLABORATORS_TABLE,
      Item: {
        projectId,
        userId,
        role, // 'editor' or 'viewer'
        addedAt: new Date().toISOString(),
        addedBy: inviterId
      },
      ConditionExpression: 'attribute_not_exists(projectId) AND attribute_not_exists(userId)' // Prevent duplicates
    }));

    // 3. Optionally, increment the collaboratorCount in the projects table
    await docClient.send(new UpdateCommand({
        TableName: PROJECTS_TABLE,
        Key: { projectId },
        UpdateExpression: 'ADD collaboratorCount :inc',
        ExpressionAttributeValues: {
            ':inc': 1
        }
    }));

    res.json({ message: 'User invited successfully' });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
        return res.status(409).json({ message: 'User is already a collaborator' });
    }
    console.error('Invite user error:', error);
    res.status(500).json({ message: 'Failed to invite user' });
  }
});

// Get project collaborators
app.get('/api/projects/:projectId/collaborators', verifyToken, async (req, res) => {
  const { projectId } = req.params;

  try {
    const collaboratorsResult = await docClient.send(new QueryCommand({
      TableName: COLLABORATORS_TABLE,
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: {
        ':projectId': projectId
      }
    }));

    const collaborators = await Promise.all(
      collaboratorsResult.Items.map(async (collab) => {
        const userResult = await docClient.send(new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId: collab.userId }
        }));
        return {
          userId: collab.userId,
          email: userResult.Item ? userResult.Item.email : 'Unknown',
          role: collab.role
        };
      })
    );

    res.json(collaborators);
  } catch (error) {
    console.error('Get collaborators error:', error);
    res.status(500).json({ message: 'Failed to get collaborators' });
  }
});

// Remove collaborator from project
app.delete('/api/projects/:projectId/collaborators/:userId', verifyToken, async (req, res) => {
  const { projectId, userId } = req.params;
  const requesterId = req.user.sub;

  try {
    // 1. Verify that the requester is the project owner
    const projectResult = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    if (!projectResult.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (projectResult.Item.ownerId !== requesterId) {
      return res.status(403).json({ message: 'Only the project owner can remove collaborators' });
    }

    // 2. Delete the collaborator entry
    await docClient.send(new DeleteCommand({
      TableName: COLLABORATORS_TABLE,
      Key: { projectId, userId }
    }));

    // 3. Decrement the collaboratorCount in the projects table
    await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: 'ADD collaboratorCount :dec',
      ExpressionAttributeValues: {
        ':dec': -1
      }
    }));

    res.json({ message: 'Collaborator removed successfully' });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ message: 'Failed to remove collaborator' });
  }
});

// Update collaborator role
app.put('/api/projects/:projectId/collaborators/:userId', verifyToken, async (req, res) => {
  const { projectId, userId } = req.params;
  const { role } = req.body;
  const requesterId = req.user.sub;

  if (!role) {
    return res.status(400).json({ message: 'Role is required' });
  }

  try {
    // 1. Verify that the requester is the project owner
    const projectResult = await docClient.send(new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId }
    }));

    if (!projectResult.Item) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (projectResult.Item.ownerId !== requesterId) {
      return res.status(403).json({ message: 'Only the project owner can update collaborators' });
    }

    // 2. Update the collaborator's role
    await docClient.send(new UpdateCommand({
      TableName: COLLABORATORS_TABLE,
      Key: { projectId, userId },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': role
      }
    }));

    res.json({ message: 'Collaborator role updated successfully' });
  } catch (error) {
    console.error('Update collaborator error:', error);
    res.status(500).json({ message: 'Failed to update collaborator role' });
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

// Setup Redis adapter for Socket.io scaling (production only)
if (process.env.REDIS_HOST) {
  const pubClient = createClient({ url: `redis://${process.env.REDIS_HOST}:6379` });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Redis adapter connected for Socket.io scaling');
  }).catch((error) => {
    console.error('❌ Redis adapter connection failed:', error);
  });
}

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

  // In-memory collaborative state per project (minimal starter)
  // Structure: { bpm: number, version: number, updatedAt: ISOString }
  // Note: In production, persist to DynamoDB and/or CRDT storage.
  if (!global.__ROOM_STATES__) global.__ROOM_STATES__ = new Map();
  const ROOM_STATES = global.__ROOM_STATES__;

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

      // Initialize room state if missing
      if (!ROOM_STATES.has(projectId)) {
        ROOM_STATES.set(projectId, {
          bpm: 120,
          version: 0,
          updatedAt: new Date().toISOString(),
        });
      }

      // Send current state to the joining client
      socket.emit('project-state', {
        projectId,
        state: ROOM_STATES.get(projectId)
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

  // Presence updates (cursor, selection, tool, etc.)
  socket.on('presence-update', ({ room, presence }) => {
    // Attach server-side identity
    socket.to(room).emit('presence-update', {
      userId: socket.userId,
      email: socket.userEmail,
      presence,
    });
  });

  // Minimal collaborative operations
  // op = { type: 'set-bpm', payload: { bpm } }
  socket.on('project-op', ({ room, op }) => {
    try {
      const projectId = room.replace('beat-room-', '');
      const state = global.__ROOM_STATES__?.get(projectId);

      if (!state) return; // ignore if room not initialized

      if (op?.type === 'set-bpm') {
        const bpm = Number(op?.payload?.bpm);
        if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 240) {
          state.bpm = bpm;
          state.version = (state.version || 0) + 1;
          state.updatedAt = new Date().toISOString();

          // Broadcast to other users in the room
          socket.to(room).emit('project-op', {
            projectId,
            op: { type: 'set-bpm', payload: { bpm } },
            version: state.version,
            updatedAt: state.updatedAt,
            user: { id: socket.userId, email: socket.userEmail }
          });
        }
      }
    } catch (e) {
      console.error('project-op error:', e);
    }
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

// Basic error handler (last)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Error:', err && err.stack ? err.stack : err);
  const message = err && err.message ? err.message : 'Server error';
  const status = message.includes('Unsupported file type') ? 400 : 500;
  res.status(status).json({ error: message });
});
