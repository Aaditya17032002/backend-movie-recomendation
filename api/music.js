const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const LASTFM_API_KEY = 'a4bd6451b29fd5ff1eaebb62357f57d6';
const LASTFM_SHARED_SECRET = 'c55e1f8dafa5ba85c770cf3ac487458a';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getLastFmData(track, artist) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'track.getInfo',
                api_key: LASTFM_API_KEY,
                artist: artist,
                track: track,
                format: 'json'
            }
        });
        return response.data.track;
    } catch (error) {
        console.error('Last.fm API Error:', error);
        return null;
    }
}

async function getSimilarTracks(track, artist) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'track.getSimilar',
                api_key: LASTFM_API_KEY,
                artist: artist,
                track: track,
                format: 'json',
                limit: 10
            }
        });
        return response.data.similartracks.track;
    } catch (error) {
        console.error('Last.fm Similar Tracks Error:', error);
        return [];
    }
}

async function getTopTracksByTag(tag) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'tag.gettoptracks',
                api_key: LASTFM_API_KEY,
                tag: tag,
                format: 'json',
                limit: 10
            }
        });
        return response.data.tracks.track;
    } catch (error) {
        console.error('Last.fm Top Tracks Error:', error);
        return [];
    }
}

async function analyzeMusicTaste(likedTracks, preferences) {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `
        Analyze these music tracks and preferences to understand the user's taste:
        Liked Tracks: ${likedTracks.join(', ')}
        Genres: ${preferences.genres.join(', ')}
        Mood: ${preferences.mood}
        
        Provide recommendations for:
        1. Similar tracks to the ones they like
        2. Underrated tracks in their preferred genres
        3. Latest releases that match their taste
        
        Format the response as a JSON array of tracks with:
        - title
        - artist
        - reasoning
        - tags (array of genres/moods)
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return JSON.parse(text);
    } catch (error) {
        console.error('Gemini API Error:', error);
        return [];
    }
}

async function getMusicRecommendations(req, res) {
    try {
        const { likedTracks, preferences } = req.body;
        
        // Get recommendations from Gemini
        const geminiRecommendations = await analyzeMusicTaste(likedTracks, preferences);
        
        // Enrich recommendations with Last.fm data
        const enrichedRecommendations = await Promise.all(
            geminiRecommendations.map(async (rec) => {
                const lastFmData = await getLastFmData(rec.title, rec.artist);
                const similarTracks = await getSimilarTracks(rec.title, rec.artist);
                
                return {
                    ...rec,
                    type: 'music',
                    listeners: lastFmData?.listeners || 'N/A',
                    image: lastFmData?.image?.[3]?.['#text'] || null,
                    description: lastFmData?.wiki?.content || rec.reasoning,
                    similarTracks: similarTracks.slice(0, 5).map(track => ({
                        title: track.name,
                        artist: track.artist.name
                    }))
                };
            })
        );

        res.status(200).json({ recommendations: enrichedRecommendations });
    } catch (error) {
        console.error('Music Recommendation Error:', error);
        res.status(500).json({
            error: 'Failed to generate music recommendations',
            details: error.message
        });
    }
}

module.exports = {
    getMusicRecommendations
}; 