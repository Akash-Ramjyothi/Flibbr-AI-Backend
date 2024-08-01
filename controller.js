/* 
Implement a chat interface with a bot.
1. Users can signup and login
2. Can see their previous chats
3. Start new chat 
4. React to responses 

*/

// Design a backend service.

// Proposed Endpoints with sample Request and Response:

// 1.1 User Sign Up:

POST /api/signup

// Request:
{
  "username": "johndoe",
  "password": "password123"
}

// Response:
{
  "message": "User registered successfully",
  "userId": "1"
}

// 1.2  User Login:

POST /api/login

// Request:
{
    "username":"user",
    "password":"pass"
}

// Response:
{
  "message": "Login successful",
  "token": "jwt-token"
}

// 2.1 Can see their previous chats:

GET /api/chats

// Request Header:
{
  "authorization": "jwt-token"
}

// Response:
{
  "chats": [
    { "chatId": "1", "title": "Chat with Bot 1", "lastMessage": "Message 1" },
    { "chatId": "2", "title": "Chat with Bot 2", "lastMessage": "Message2" }
  ]
}

// 2.2 Fetch all messages of Single chat:

GET /api/chats/{chatId}

// Response:
{
  "chatId": "1",
  "title": "Chat with Bot 1",
  "messages": [
    { "sender": "bot", "message": "Message 1" },
    { "sender": "user", "message": "Message 2" }
  ]
}

// 3.1 Start new chat:

POST /api/chats

// Request:
{
  "authorization": "jwt-token",  
  "title": "New Chat with Bot"
}

// Response:
{
  "message": "Chat created successfully",
  "chatId": "3"
}

// 3.2 Send Message to Chat-Bot:

POST /api/chats/{chatId}/messages

// Request:
{
    "message": "Please list the features of Flibbr AI"
}

// Response:
{
  "message": "Message sent successfully",
  "chatId": "1",
  "sender": "user",
  "newMessage": "This is about Flibbr"
}

// 4. React to responses 

POST /api/chats/{chatId}/messages/{messageId}/reactions

// Request:
{
  "reaction": "like"
}

// Response:
{
  "message": "Reaction Added",
  "chatId": "1",
  "messageId": "10",
  "reaction": "like"
}