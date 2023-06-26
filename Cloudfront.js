const https = require('https');

/**
 * Example code for a Lambda function that can proxy requests, extract an Arkose Labs token from the
 * request and verify the token on the Cloudfront CDN layer
 *
 * This requires the following environment variables being setup for the Cloudflare Worker
 * @param {string} privateKey The Arkose Labs private key to use for verification
 * @param {string} errorUrl A url to redirect to if there has been an error
 * @param {string} tokenIdentifier The property name for the body / cookie that contains the Arkose Labs token
 * @param {string} tokenMethod The storage method of the Arkose Labs token, this can be either "body" or "cookie".
 * @param {boolean} failOpen A boolean string to indicate if the current session should fail
 * open if there is a problem with the Arkose Labs platform.
 * @param {integer} verifyMaxRetryCount A numeric string to represent the number of times we should retry
 * Arkose Labs verification if there is an issue.
 * @param {string} verifyApiUrl A customer's specific url used for the verification call (if setup)
 * default is verify-api.arkoselabs.com
 * @param {Object} redirectResponse The redirect callback if an error occurs
 */
const privateKey  = '11111111-1111-1111-1111-111111111';
const errorUrl = 'https://www.arkoselabs.com';
const tokenIdentifier = 'arkose-token';
const tokenMethod = 'cookie';
const failOpen = true;
const verifyMaxRetryCount = 3;
const verifyApiUrl = 'verify-api.arkoselabs.com';
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

/**
 * Returns a specified cookie value from request object
 * @param  {object} event The event to extract the cookie value from
 * @param  {string} cookieKey The cookie key to extract the value for
 * @return {string} the cookie value of the specified key
 */
const getTokenCookie = (event, cookieKey) => {
  const cookieString = event.Records[0].cf.request.headers.cookie;
  console.log(cookieString)
  if (cookieString) {
    const allCookies = cookieString[0].value.split('; ');
    const targetCookie = allCookies.find((cookie) =>
      cookie.includes(cookieKey)
    );
    if (targetCookie) {
      const [, value] = targetCookie.split(`${cookieKey}=`);
      return value;
    }
  }
  return null;
};

/**
 * Sends token to Arkose Labs Verify endpoint and returns the verify payload
 * @param  {Object} body An object containing both the private key and session token to validate
 * @param  {string} verifyApiUrl The URL of the verify endpoint to use
 * @return {Object} The verify payload returned from the Arkose Lbas endpoint
 */
function postRequest(body) {
  const options = {
    hostname: verifyApiUrl,
    path: '/api/v4/verify/',
    method: 'POST',
    port: 443, 
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

/**
 * Sends request to Arkose Labs Status endpoint and returns the status object
 * @return {Object} An object representation of the current Arkose Labs platform status
 */
function getStatus() {
  const options = {
    hostname: 'status.arkoselabs.com',
    path: '/api/v2/status.json',
    method: 'GET',
    port: 443,  
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

/**
* Returns a specified body value from a request
* @param  {Object} event The request to fetch the body value from
* @param  {string} bodyKey The body key to extract the value for
  @return {string} the body value of the specified key
*/
const getTokenBody = (event, bodyKey) => {
   let request = event.Records[0].cf.request;
   let body = request.body;
   let data = JSON.stringify(body["data"]);
   let decodedData = Buffer.from(data,'base64').toString('ascii');
   let parsedData = JSON.parse(decodedData);
  return parsedData[bodyKey];
};

/**
 * Checks the current status of the Arkose Labs platform
 * @return {boolean} A boolean representation of the current Arkose Labs platform status,
 * true means the platform is stable, false signifies an outage.
 */
const checkArkoseStatus = async () => {
  try {
    const healthJson = await getStatus();
    const status = healthJson.status.indicator;
    return !(status === 'critical');
  } catch (error) {
    return false;
  }
};

/**
 * Verifies an arkose token, including retry and platform status logic
 * @param  {string} token The Arkose Labs session token value
 * @param  {string} privateKey The Arkose Labs private key
 * @param  {integer} retryMaxCount The number of retries that should be performed if there is an issue
 * @param  {integer} [currentRetry=0] The count of the current number of retries being performed
 * @return {Object} status The current verification and Arkose Labs platform status
 * @return {boolean} status.verified Has the token verified successfully
 * @return {boolean} statis.arkoseStatus The current status of the Arkose Labs platform
 */
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

/**
 * Returns an Arkose Labs token from the current request
 * @param  {Object} event The request to fetch the header from
 * @param  {string} tokenMethod The method to use for extracting the Arkose Labs token, this has two
 * potential values "cookie" and "body"
 * @param  {string} tokenIdentifier An identifier string of the property the token is stored in
 * @return {string} the specified Arkose Labs token
 */
const getArkoseToken = (event, tokenMethod, tokenIdentifier) => {
  const tokenFunction =
    tokenMethod === 'cookie' ? getTokenCookie : getTokenBody;
  return tokenFunction(event, tokenIdentifier);
};

exports.handler = async (event, context, callback) => {
      
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
