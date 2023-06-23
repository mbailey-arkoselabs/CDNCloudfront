const https = require('https');

const getTokenCookie = (request, cookieKey) => {
  //only needed if using Cookies
  return null;
};

function postRequest(body) {
  const options = {
    hostname: 'verify-api.arkoselabs.com',
    path: '/api/v4/verify/',
    method: 'POST',
    port: 443, // 
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on('error', err => {
      reject(new Error(err));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

function getStatus() {
  const options = {
    hostname: 'status.arkoselabs.com',
    path: '/api/v2/status.json',
    method: 'GET',
    port: 443, // 
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
     let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on('error', err => {
      reject(new Error(err));
    });
  });
}

const getTokenHeader = (event, headerKey) => {
   let request = event.Records[0].cf.request;
   let body = request.body;
   let data = JSON.stringify(body["data"]);
   let decodedData = Buffer.from(data,'base64').toString('ascii');
   let parsedData = JSON.parse(decodedData);
  return parsedData.token;
};

const checkArkoseStatus = async () => {
  try {

    const healthJson = await getStatus();
    const status = healthJson.status.indicator;
    return !(status === 'critical');
  } catch (error) {
    return false;
  }
};

const verifyArkoseToken = async (
  token,
  privateKey,
  retryMaxCount,
  currentRetry = 0
) => {
  let verified = false;
  let arkoseStatus = true;
  try {
    const payload = {
      private_key: privateKey,
      session_token: token,
    };
    const data = await postRequest(payload);

    if (data.session_details && data.session_details.solved) {
      verified = true;
    }
    return { verified, arkoseStatus };
  } catch {
    arkoseStatus = await checkArkoseStatus();
    if (arkoseStatus) {
      if (currentRetry === retryMaxCount) {
        return { verified, arkoseStatus };
      }
      return await verifyArkoseToken(
        token,
        privateKey,
        retryMaxCount,
        currentRetry + 1
      );
    }
    return { verified, arkoseStatus };
  }
};


const getArkoseToken = (request, tokenMethod, tokenIdentifier) => {
  
  const tokenFunction =
    tokenMethod === 'cookie' ? getTokenCookie : getTokenHeader;
  return tokenFunction(request, tokenIdentifier);
};


exports.handler = async (event, context, callback) => {

    const privateKey  = '1111111-1111-1111-1111-11111111';
    const errorUrl = 'https://www.arkoselabs.com';
    const tokenIdentifier = 'arkose-token';
    const tokenMethod = 'header';
    const failOpen = true;
    const verifyMaxRetryCount = 3;
    
    const redirectResponse = {
        status: '301',
        statusDescription: 'Token Error',
        headers: {
          'location': [{
            key: 'Location',
            value: errorUrl,
          }],

        },
    };
    

    // extracts the Arkose Labs token from the request
    
    const arkoseToken = getArkoseToken(event, tokenMethod, tokenIdentifier);


    // if an Arkose Labs token is found, process it
    if (arkoseToken && arkoseToken !== '') {
      const verifyStatus = await verifyArkoseToken(
        arkoseToken,
        privateKey,
        verifyMaxRetryCount
      );

      // If session is verified, continue with response
      if (verifyStatus.verified) {
       callback(null, event.Records[0].cf.request);
      }

      // If Arkose has an outage and failOpen is configured to true, continue with response
      if (!verifyStatus.arkoseStatus && failOpen) {
        //const response = await fetch(request);
        //return response;
         callback(null, event.Records[0].cf.request);
      }

      // If session is not verified and Arkose does not have an outage, handle failure
      callback(null, redirectResponse);
    }
    // If no token is found, handle failure
    callback(null, redirectResponse);
  };