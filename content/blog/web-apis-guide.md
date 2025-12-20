+++
date = '2025-02-19'
draft = false
title = "A Noob's Guide to Web APIs"
summary = 'Learn what APIs are, how they work, and how to create your own simple API using Node.js and Express.'
tags = ['nodejs', 'express', 'api', 'web-development', 'backend']
+++

*Alllll riiiight lets do this one more time*, my name is Ankush and I'm your friendly neighbourhood web developer, here to educate your pathetic ass a bit about web APIs, how they can be used to connect your frontend with your backend and how you can write an API using NodeJS 🫡

An API — Application Programming Interface, defines how different applications can talk to each other and exchange data through structured requests and responses.

---

## API Types

1. **Web APIs** — the one we will be focusing on today
2. **OS APIs** — Windows APIs, Android APIs, etc
3. **Library APIs** — Like a python library
4. **Hardware APIs** — allow accessing hardware functions (embedded libraries?)

---

## RESTful Web APIs

A RESTful Web API is one that follows the "REST" (Representational State Transfer) principles, a software architecture style that ensures scalability, simplicity, and stateless communication between servers and clients.

### Common REST HTTP Methods

There are 4 common methods/requests to call REST APIs:

1. **GET** — to get some data from the server
2. **POST** — to send/create some data from the server and get a response
3. **PUT** — to update existing data on a server
4. **DELETE** — to remove some data from a server

When browsing the web, a GET request is used to fetch the client-side content that gets rendered by the browser.

### API Response Codes

Whenever an API is called, it will always return a **status code** (a number) to signify the result of the request.

- **1XX**: Informational response
- **2XX**: Success codes (e.g., 200 — OK)
- **3XX**: Redirects (e.g., 301 — Moved Permanently)
- **4XX**: Client errors (e.g., 400 — Bad Request, 401 — Unauthorised, 404 — Not Found)
- **5XX**: Server errors (e.g., 500 — Internal Server Error)

---

## Let's Write an API Endpoint Ourselves

Make sure you have NodeJS + NPM already installed and follow these steps:

```bash
mkdir api-test
cd api-test
npm init -y
npm i express
touch index.js
```

This will create a folder for our express API backend and create a JS file to write code in. Edit the `index.js` file and add this code:

```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World');
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
```

We have just initialised an express backend which is serving the "Hello World" string at the root (/) endpoint. i.e. on sending a GET request to `/`, "Hello World" will be returned.

Run this file with:

```bash
node index.js
```

And open `http://localhost:3000/` on any browser. It should show "Hello World".

![Hello World Demo](https://miro.medium.com/v2/resize:fit:1324/format:webp/1*fh2r1wAEpvcPK0bZpV9Y-Q.png)

Try changing the string in `res.send('this one')` to simple HTML like `<h1>Hi there</h1>` and restart the express server (ctrl+c and `node index.js` again), check if something changes on the served page.

---

## Defining a POST Endpoint

But this is just for GET requests, we cannot make POST requests to this endpoint.

![POST Request Error](https://miro.medium.com/v2/resize:fit:1236/format:webp/1*cJV5BQAHvocrDKE_LO1jMQ.png)

As you can see it gives an error if we try to make a POST request to the GET endpoint we created. Let's define a POST endpoint now. Add this after defining the app:

```javascript
app.use(express.json());

// POST endpoint
app.post('/', (req, res) => {
  const name = req.body.name;
  res.send(`Hello ${name}!`);
});
```

Restart the app and let's try sending a post request to the server. You can use any HTTP client like Thunder Client on VSCode or Postman. I am going to use cURL coz simple:

```bash
curl http://localhost:3000/ -d '{ "name": "Ankush" }' -H "Content-Type: application/json"
```

This should print the response as:

**Hello Ankush!**

BOOM! You just created a GET and POST request! A majority of web APIs are comprised of just GET and POST requests.

---

## Time to Write Some Frontend

Now let's serve an HTML page that interacts with our POST endpoint:

```html
<html>
  <body>
    <input type="text" id="name" name="name" placeholder="Enter your name">
    <button onclick="handleSubmit()">Submit</button>
    <script>
      async function handleSubmit() {
        const name = document.getElementById('name').value;
        const response = await fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name })
        });
        const data = await response.text();
        document.body.innerHTML = data;
      }
    </script>
  </body>
</html>
```

We will serve this HTML through the GET endpoint we created earlier:

```javascript
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <input type="text" id="name" name="name" placeholder="Enter your name">
        <button onclick="handleSubmit()">Submit</button>
        <script>
          async function handleSubmit() {
            const name = document.getElementById('name').value;
            const response = await fetch('/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ name })
            });
            const data = await response.text();
            document.body.innerHTML = data;
          }
        </script>
      </body>
    </html>
  `);
});
```

Restart the express app and refresh `localhost:3000`, and try entering your name.

![Frontend Demo with Network Tab](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*KhXDm_zbhiECJnoVBZE-XA.png)

Now if you open developer tools and go into the network tab, you can see the POST request being sent and the different data associated with it.

![Network Tab](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*Wkbk2CrKOqYMwyQ11P9Eiw.png)

---

And that's a wrap! You've just learned the basics of web APIs, REST principles, and created your own simple API with both GET and POST endpoints. Now go build something cool! 🚀
